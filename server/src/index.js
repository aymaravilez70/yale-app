const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const NodeCache = require('node-cache');
require('dotenv').config({ override: true });
// YtDlpExec dependency removed in favor of youtubei.js

const app = express();
app.use(cors());
app.use(express.json());


let Innertube;
let ytInstance = null;
const streamUrlCache = new NodeCache({ stdTTL: 1800, checkperiod: 300 });

const CDN_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Referer': 'https://www.youtube.com/'
};

async function getYoutubeInstance() {
  if (!ytInstance) {
    if (!Innertube) {
      const module = await import('youtubei.js');
      Innertube = module.Innertube;
      const Platform = module.Platform;
      const vm = require('vm');
      if (Platform && Platform.shim) {
        Platform.shim.eval = (code, env) => {
          const wrappedCode = `(() => { ${code.output} })()`;
          return vm.runInNewContext(wrappedCode, env);
        };
      }
    }
    ytInstance = await Innertube.create();
  }
  return ytInstance;
}

app.get('/api/youtube/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Falta q' });
  console.log(`🔍 BUSQUEDA YOUTUBE ILIMITADA (youtubei.js): "${query}"`);
  try {
    const yt = await getYoutubeInstance();
    const searchResults = await yt.search(query, { type: 'video' });
    const results = (searchResults.results || [])
      .filter(video => video.type === 'Video')
      .map(video => {
        const thumbnails = video.thumbnails || [];
        const miniatura = thumbnails.length > 0 
          ? thumbnails[thumbnails.length - 1].url 
          : `https://img.youtube.com/vi/${video.id}/mqdefault.jpg`;
        return {
          id: video.id,
          titulo: video.title?.text || video.title || `Video ${video.id}`,
          miniatura: miniatura
        };
      });

    console.log(`✅ RESULTADOS ENCONTRADOS: ${results.length}`);
    res.json(results);
  } catch (error) {
    console.error("❌ ERROR EN EL SERVIDOR (SEARCH):", error.message);
    res.status(500).json({ error: 'Error interno de búsqueda', message: error.message });
  }
});

app.get('/api/youtube/recommendations', async (req, res) => {
  const query = req.query.q || 'music';
  console.log(`🔍 RECOMENDACIONES YOUTUBE ILIMITADAS (youtubei.js): "${query}"`);
  try {
    const yt = await getYoutubeInstance();
    const searchResults = await yt.search(query, { type: 'video' });
    const results = (searchResults.results || [])
      .filter(video => video.type === 'Video')
      .slice(0, 16)
      .map(video => {
        const thumbnails = video.thumbnails || [];
        const miniatura = thumbnails.length > 0 
          ? thumbnails[thumbnails.length - 1].url 
          : `https://img.youtube.com/vi/${video.id}/mqdefault.jpg`;
        return {
          id: video.id,
          titulo: video.title?.text || video.title || `Video ${video.id}`,
          miniatura: miniatura
        };
      });

    console.log(`✅ RECOMENDACIONES ENCONTRADAS: ${results.length}`);
    res.json(results);
  } catch (error) {
    console.error("❌ ERROR EN EL SERVIDOR (REC):", error.message);
    res.status(500).json({ error: 'Error interno de recomendaciones', message: error.message });
  }
});

app.get('/api/youtube/info/:videoId', async (req, res) => {
  const { videoId } = req.params;
  console.log(`ℹ️ OBTENIENDO INFO YOUTUBE (youtubei.js): ${videoId}`);
  try {
    const yt = await getYoutubeInstance();
    const info = await yt.getBasicInfo(videoId);
    const thumbnails = info.basic_info.thumbnail || [];
    const miniatura = thumbnails.length > 0
      ? thumbnails[thumbnails.length - 1].url
      : `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

    res.json({
      titulo: info.basic_info.title || `Video ${videoId}`,
      miniatura: miniatura
    });
  } catch (error) {
    console.error("❌ ERROR EN EL SERVIDOR (INFO):", error.message);
    res.status(500).json({ error: 'Error obteniendo información del video', message: error.message });
  }
});

async function resolveYoutubeStreamUrl(videoId) {
  const cached = streamUrlCache.get(videoId);
  if (cached) return cached;

  const yt = await getYoutubeInstance();
  const info = await yt.getInfo(videoId, { client: 'ANDROID' });
  let format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
  if (!format || format.has_audio === false) {
    const combined = (info.streaming_data?.formats || [])
      .filter((f) => f.has_video && f.has_audio)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    format = combined[0] || info.chooseFormat({ type: 'video+audio', quality: '360p' });
  }
  if (!format) {
    throw new Error('No se encontró un formato de video+audio adecuado');
  }
  if (format.has_audio === false) {
    throw new Error('El formato obtenido no incluye pista de audio');
  }

  const streamUrl = await format.decipher(yt.session.player);
  if (!streamUrl) {
    throw new Error('No se pudo descifrar URL de stream');
  }

  streamUrlCache.set(videoId, streamUrl);
  return streamUrl;
}

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

const streamWithYoutubeiJs = async (req, res, videoId, json) => {
  console.log(`🎬 OBTENIENDO STREAM YOUTUBE (youtubei.js): ${videoId}`);
  try {
    if (json === 'true') {
      const base = getPublicBaseUrl(req);
      return res.json({
        streamUrl: `${base}/api/youtube/stream?videoId=${encodeURIComponent(videoId)}`,
        contentType: 'video/mp4'
      });
    }

    const streamUrl = await resolveYoutubeStreamUrl(videoId);
    const fetchHeaders = { ...CDN_FETCH_HEADERS };
    if (req.headers.range) {
      fetchHeaders.Range = req.headers.range;
    }

    const response = await fetch(streamUrl, { headers: fetchHeaders });
    if (!response.ok && response.status !== 206) {
      streamUrlCache.del(videoId);
      throw new Error(`Proxy error: ${response.status}`);
    }

    res.status(response.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
      const val = response.headers.get(h);
      if (val) res.setHeader(h, val);
    }
    if (!res.getHeader('content-type')) {
      res.setHeader('Content-Type', 'video/mp4');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!res.getHeader('accept-ranges')) {
      res.setHeader('Accept-Ranges', 'bytes');
    }

    const reader = response.body.getReader();
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            break;
          }
          res.write(Buffer.from(value));
        }
      } catch (err) {
        console.error('Error en el stream de origen:', err.message);
        if (!res.headersSent) res.status(500);
        res.end();
      }
    };
    pump();
  } catch (err) {
    console.error('❌ youtubei.js stream error:', err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Error de stream', message: err.message });
    }
    res.end();
  }
};

app.get('/api/youtube/stream', async (req, res) => {
  const { videoId, json, _retry } = req.query;
  if (!videoId) return res.status(400).json({ error: 'Falta videoId' });
  if (_retry) streamUrlCache.del(videoId);

  return streamWithYoutubeiJs(req, res, videoId, json);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let rooms = {};
const deleteTimeouts = {}; // Almacenamos los timeouts aquí para no contaminar el objeto rooms (evita crash circular de socket.io)
const DISCONNECT_GRACE_MS = 60000; // 60s antes de sacar a alguien por desconexión (segundo plano / red)
const pendingDisconnects = {}; // `${roomId}:${username}` -> { timeout, socketId }

const crearMensajeSistema = (text) => ({
  id: `sys-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  username: 'Yale',
  text,
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  isSystem: true
});

const emitirColaActualizada = (roomId) => {
  const room = rooms[roomId];
  if (!room) return;
  const cola = room.queue || [];
  io.to(roomId).emit('queue-updated', cola);
};

const avanzarColaOFinalizar = (roomId) => {
  const room = rooms[roomId];
  if (!room) return;

  if (room.queue && room.queue.length > 0) {
    const siguiente = room.queue.shift();
    room.video_actual = {
      id: siguiente.id,
      titulo: siguiente.titulo,
      miniatura: siguiente.miniatura,
      browserUrl: siguiente.browserUrl,
      browserPlatform: siguiente.browserPlatform,
      state: 'PLAYING',
      currentTime: 0,
      lastUpdate: Date.now()
    };
    console.log(`▶️ SIGUIENTE EN COLA (${roomId}): ${siguiente.titulo}`);
    io.to(roomId).emit('room-state', room);
    emitirColaActualizada(roomId);
    io.to(roomId).emit('receive-message', crearMensajeSistema(`Ahora suena: ${siguiente.titulo}`));
    return;
  }

  if (room.video_actual) {
    room.video_actual.state = 'PAUSED';
    room.video_actual.lastUpdate = Date.now();
  }
  console.log(`⏹️ COLA VACÍA (${roomId}) — mostrando sugerencias`);
  io.to(roomId).emit('room-state', room);
  io.to(roomId).emit('queue-empty');
  emitirColaActualizada(roomId);
};

const cancelPendingDisconnect = (roomId, username) => {
  const key = `${roomId}:${username}`;
  const pending = pendingDisconnects[key];
  if (!pending) return;
  clearTimeout(pending.timeout);
  delete pendingDisconnects[key];
  console.log(`✅ Reconexión: cancelada salida pendiente de ${username} en ${roomId}`);
};

const removerParticipanteDeSala = (roomId, socket, { silent = false } = {}) => {
  const room = rooms[roomId];
  if (!room) return false;

  const index = room.participantes.findIndex((p) => p.socket_id === socket.id);
  if (index === -1) return false;

  const usuarioQueSale = room.participantes[index];
  cancelPendingDisconnect(roomId, usuarioQueSale.username);
  room.participantes.splice(index, 1);

  console.log(`🏃 USUARIO SALIÓ: ${usuarioQueSale.username} de sala ${roomId}`);

  if (!silent) {
    const systemMsg = {
      id: `sys-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      username: 'Yale',
      text: `${usuarioQueSale.username} ha salido de la sala.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isSystem: true
    };
    io.to(roomId).emit('receive-message', systemMsg);
  }

  if (room.participantes.length === 0) {
    console.log(`⏳ SALA VACÍA. Temporizador de 10s activado para eliminar sala: ${roomId}`);

    deleteTimeouts[roomId] = setTimeout(() => {
      if (rooms[roomId] && rooms[roomId].participantes.length === 0) {
        delete rooms[roomId];
        delete deleteTimeouts[roomId];
        console.log(`🗑️ SALA ELIMINADA POR INACTIVIDAD: ${roomId}`);
        io.to('lobby').emit('lista-salas-actualizada', Object.values(rooms));
      }
    }, 10000);
  } else {
    if (usuarioQueSale.username === room.creador) {
      room.creador = room.participantes[0].username;
      console.log(`👑 NUEVO HOST: ${room.creador}`);
      io.to(roomId).emit('room-state', room);
    }
    io.to(roomId).emit('participante-salio', room.participantes);
  }

  io.to('lobby').emit('lista-salas-actualizada', Object.values(rooms));
  socket.leave(roomId);
  return true;
};

const programarSalidaPorDesconexion = (socket) => {
  for (const roomId in rooms) {
    const participante = rooms[roomId].participantes.find((p) => p.socket_id === socket.id);
    if (!participante) continue;

    const key = `${roomId}:${participante.username}`;
    if (pendingDisconnects[key]) clearTimeout(pendingDisconnects[key].timeout);

    console.log(
      `⏳ Desconexión temporal (${DISCONNECT_GRACE_MS / 1000}s): ${participante.username} en ${roomId}`
    );

    pendingDisconnects[key] = {
      socketId: socket.id,
      timeout: setTimeout(() => {
        delete pendingDisconnects[key];
        const room = rooms[roomId];
        if (!room) return;
        const aunPresente = room.participantes.find(
          (p) => p.username === participante.username && p.socket_id === socket.id
        );
        if (aunPresente) {
          removerParticipanteDeSala(roomId, socket);
        }
      }, DISCONNECT_GRACE_MS)
    };
    return;
  }
};

const manejarSalidaDeSala = (socket) => {
  for (const roomId in rooms) {
    const participante = rooms[roomId].participantes.find((p) => p.socket_id === socket.id);
    if (participante) cancelPendingDisconnect(roomId, participante.username);
    removerParticipanteDeSala(roomId, socket);
  }
};

io.on('connection', (socket) => {
  console.log(`🔌 NUEVA CONEXIÓN: ${socket.id}`);

  socket.on('join-lobby', () => {
    socket.join('lobby');
    socket.emit('lista-salas-actualizada', Object.values(rooms));
    console.log(`🏠 Socket ${socket.id} entró al Lobby`);
  });

  socket.on('crear-sala', (nuevaSala) => {
    const { sala_id } = nuevaSala;
    rooms[sala_id] = {
      ...nuevaSala,
      original_creador: nuevaSala.creador,
      createdAt: Date.now(),
      participantes: [],
      queue: [],
      video_actual: {
        ...nuevaSala.video_actual,
        state: 'PLAYING',
        currentTime: 0,
        lastUpdate: Date.now()
      }
    };
    console.log(`✨✨ SALA CREADA EXITOSAMENTE: ${sala_id} ✨✨`);
    io.to('lobby').emit('lista-salas-actualizada', Object.values(rooms));
  });

  socket.on('join-room', ({ roomId, user }) => {
    if (rooms[roomId]) {
      // Cancelar el borrado si alguien entra
      if (deleteTimeouts[roomId]) {
        clearTimeout(deleteTimeouts[roomId]);
        delete deleteTimeouts[roomId];
        console.log(`✅ BORRADO CANCELADO: ${user.username} entró a la sala ${roomId}`);
      }

      socket.join(roomId);
      if (!rooms[roomId].queue) rooms[roomId].queue = [];

      cancelPendingDisconnect(roomId, user.username);

      const existBySocket = rooms[roomId].participantes.find((p) => p.socket_id === socket.id);
      const existByUser = rooms[roomId].participantes.find((p) => p.username === user.username);

      if (existByUser) {
        existByUser.socket_id = socket.id;
        existByUser.avatarUrl = user.avatarUrl || existByUser.avatarUrl;
        console.log(`🔄 ${user.username} reconectado a ${roomId} (socket actualizado)`);
      } else if (!existBySocket) {
        rooms[roomId].participantes.push({ socket_id: socket.id, ...user });

        const joinMsg = {
          id: `sys-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          username: 'Yale',
          text: `${user.username} se ha unido a la sala.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isSystem: true
        };
        io.to(roomId).emit('receive-message', joinMsg);
      }

      // Recuperar el liderazgo si es el creador original
      if (rooms[roomId].original_creador === user.username && rooms[roomId].creador !== user.username) {
        rooms[roomId].creador = user.username;
        console.log(`👑 EL CREADOR ORIGINAL VOLVIÓ Y RECUPERÓ EL MANDO: ${user.username}`);
        io.to(roomId).emit('room-state', rooms[roomId]);
      }
      
      socket.emit('room-state', rooms[roomId]);
      io.to(roomId).emit('nuevo-participante', rooms[roomId].participantes);
      io.to('lobby').emit('lista-salas-actualizada', Object.values(rooms));
      console.log(`👤 ${user.username} ENTRÓ A SALA: ${roomId}`);
    } else {
      console.log(`⚠️ INTENTO DE UNIRSE A SALA INEXISTENTE: ${roomId}`);
    }
  });

  socket.on('send-message', ({ roomId, message }) => {
    socket.to(roomId).emit('receive-message', message);
  });

  socket.on('send-reaction', ({ roomId, reactionType }) => {
    socket.to(roomId).emit('receive-reaction', reactionType);
  });

  socket.on('message-reaction', ({ roomId, messageId, emoji }) => {
    socket.to(roomId).emit('receive-message-reaction', { messageId, emoji });
  });

  socket.on('typing', ({ roomId, username }) => {
    socket.to(roomId).emit('user-typing', username);
  });

  socket.on('stop-typing', ({ roomId, username }) => {
    socket.to(roomId).emit('user-stop-typing', username);
  });

  const esHostDeSala = (roomId, socketId) => {
    const room = rooms[roomId];
    if (!room) return false;
    const participante = room.participantes.find((p) => p.socket_id === socketId);
    return participante && participante.username === room.creador;
  };

  socket.on('video-state-change', ({ roomId, state, currentTime }) => {
    if (!rooms[roomId] || !esHostDeSala(roomId, socket.id)) return;
    rooms[roomId].video_actual.state = state;
    rooms[roomId].video_actual.currentTime = currentTime;
    rooms[roomId].video_actual.lastUpdate = Date.now();
    socket.to(roomId).emit('video-state-update', { state, currentTime });
  });

  socket.on('video-seek', ({ roomId, currentTime }) => {
    if (!rooms[roomId] || !esHostDeSala(roomId, socket.id)) return;
    rooms[roomId].video_actual.currentTime = currentTime;
    rooms[roomId].video_actual.lastUpdate = Date.now();
    socket.to(roomId).emit('video-seek-update', currentTime);
  });

  socket.on('change-video', ({ roomId, video }) => {
    if (rooms[roomId] && video?.id) {
      const quien = rooms[roomId].participantes.find((p) => p.socket_id === socket.id);
      rooms[roomId].video_actual = {
        ...video,
        state: 'PLAYING',
        currentTime: 0,
        lastUpdate: Date.now()
      };
      console.log(`🎵 CAMBIO DE VIDEO (${roomId}): ${video.titulo || video.id} (por ${quien?.username || '?'})`);
      io.to(roomId).emit('room-state', rooms[roomId]);
      emitirColaActualizada(roomId);
      if (quien?.username) {
        io.to(roomId).emit(
          'receive-message',
          crearMensajeSistema(`${quien.username} puso: ${video.titulo || video.id}`)
        );
      }
    }
  });

  socket.on('add-to-queue', ({ roomId, video, username }) => {
    const room = rooms[roomId];
    if (!room || !video?.id) return;

    if (!room.queue) room.queue = [];

    const yaEnCola = room.queue.some((item) => item.id === video.id);
    const esElActual = room.video_actual?.id === video.id;
    if (yaEnCola || esElActual) {
      socket.emit('queue-updated', room.queue);
      return;
    }

    const itemCola = {
      queueId: `q-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      id: video.id,
      titulo: video.titulo || `Video ${video.id}`,
      miniatura:
        video.miniatura ||
        (video.id === 'browser_sync'
          ? 'https://www.google.com/s2/favicons?domain=kick.com&sz=128'
          : `https://img.youtube.com/vi/${video.id}/mqdefault.jpg`),
      browserUrl: video.browserUrl,
      browserPlatform: video.browserPlatform,
      addedBy: username || 'Usuario'
    };

    room.queue.push(itemCola);
    console.log(`➕ AÑADIDO A COLA (${roomId}): ${itemCola.titulo} por ${itemCola.addedBy}`);
    emitirColaActualizada(roomId);
    io.to(roomId).emit(
      'receive-message',
      crearMensajeSistema(`${itemCola.addedBy} añadió "${itemCola.titulo}" a la cola`)
    );
  });

  const hostSkipQueue = (roomId, socket, label) => {
    const room = rooms[roomId];
    if (!room) return;

    const participante = room.participantes.find((p) => p.socket_id === socket.id);
    if (!participante || participante.username !== room.creador) {
      console.log(
        `⚠️ ${label} ignorado: ${participante?.username || 'desconocido'} no es host de ${roomId}`
      );
      return;
    }

    console.log(`⏭️ ${label} (${roomId}) — avanzando cola por ${participante.username}`);
    avanzarColaOFinalizar(roomId);
  };

  socket.on('video-ended', ({ roomId }) => {
    hostSkipQueue(roomId, socket, 'video-ended');
  });

  socket.on('skip-next', ({ roomId }) => {
    hostSkipQueue(roomId, socket, 'skip-next');
  });

  socket.on('leave-room', () => manejarSalidaDeSala(socket));
  socket.on('disconnect', () => programarSalidaPorDesconexion(socket));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log('====================================');
  console.log(`🚀 SERVIDOR YALE ACTIVO EN PUERTO ${PORT}`);
  console.log('====================================');
});
