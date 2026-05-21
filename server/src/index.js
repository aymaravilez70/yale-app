const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config({ override: true });
const { Innertube, Platform } = require('youtubei.js');

const app = express();
app.use(cors());
app.use(express.json());


app.get('/api/youtube/search', async (req, res) => {
  const query = req.query.q;
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!query) return res.status(400).json({ error: 'Falta q' });
  console.log(`🔍 BUSQUEDA YOUTUBE: "${query}"`);
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=6&type=video&q=${encodeURIComponent(query)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      console.error("❌ ERROR API YOUTUBE:", data.error.message);
      return res.status(500).json({ error: data.error.message });
    }

    const results = data.items?.map(item => ({
      id: item.id.videoId,
      titulo: item.snippet.title,
      miniatura: item.snippet.thumbnails.high.url
    })) || [];

    console.log(`✅ RESULTADOS ENCONTRADOS: ${results.length}`);
    res.json(results);
  } catch (error) {
    console.error("❌ ERROR EN EL SERVIDOR (SEARCH):", error);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/youtube/recommendations', async (req, res) => {
  const query = req.query.q || 'music';
  const apiKey = process.env.YOUTUBE_API_KEY;
  console.log(`🔍 RECOMENDACIONES YOUTUBE: "${query}"`);
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=16&type=video&q=${encodeURIComponent(query)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error("❌ ERROR API YOUTUBE (REC):", data.error.message);
      return res.status(500).json({ error: data.error.message });
    }

    const results = data.items?.map(item => ({
      id: item.id.videoId,
      titulo: item.snippet.title,
      miniatura: item.snippet.thumbnails.high.url
    })) || [];

    console.log(`✅ RECOMENDACIONES ENCONTRADAS: ${results.length}`);
    res.json(results);
  } catch (error) {
    console.error("❌ ERROR EN EL SERVIDOR (REC):", error);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get('/api/youtube/stream', async (req, res) => {
  const { videoId, json } = req.query;
  if (!videoId) return res.status(400).json({ error: 'Falta videoId' });
  
  console.log(`🎬 OBTENIENDO STREAM YOUTUBE: ${videoId}`);
  try {
    const youtube = await Innertube.create({
      cache: new (require('node-cache'))(),
      generate_session_locally: true
    });

    const info = await youtube.getInfo(videoId);
    
    // Debug: Log la estructura de streaming_data
    console.log(`📊 Info del video:`, {
      title: info.basic_info?.title,
      videoDetails: !!info.basic_info,
      hasStreamingData: !!info.streaming_data,
    });

    // Verificar si es un video válido
    if (!info.basic_info?.title) {
      console.warn(`⚠️ Video no encontrado o no es válido: ${videoId}`);
      return res.status(404).json({ error: 'Video no encontrado' });
    }

    // Si no hay streaming_data, intentar obtener el mejor formato disponible
    if (!info.streaming_data) {
      console.warn(`⚠️ Sin streaming_data. Intentando obtener mejor formato disponible...`);
      
      // Intentar usar el método de descarga de youtube.js si está disponible
      try {
        const format = await youtube.chooseFormat({ quality: 'best[ext=mp4]', type: 'audio' });
        if (format?.url) {
          console.log(`✅ Formato obtenido vía alternativo`);
          const streamUrl = format.url;
          
          if (json === 'true') {
            return res.json({ streamUrl });
          } else {
            const response = await fetch(streamUrl, {
              headers: {
                'Referer': 'https://www.youtube.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
              }
            });
            res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mp4');
            res.setHeader('Content-Length', response.headers.get('content-length'));
            res.setHeader('Access-Control-Allow-Origin', '*');
            response.body.pipe(res);
            return;
          }
        }
      } catch (altError) {
        console.warn(`⚠️ Método alternativo falló:`, altError.message);
      }

      return res.status(404).json({ 
        error: 'No streaming data', 
        hint: 'Video podría estar restringido geográficamente o requiere autenticación'
      });
    }
    
    // Buscar formato de audio de buena calidad en adaptive_formats
    let audioFormats = info.streaming_data?.adaptive_formats?.filter(f => 
      f.audio_codec && !f.video_codec
    ).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0)) || [];

    // Fallback: si no hay adaptive, buscar en formats regulares (que tienen audio+video)
    if (audioFormats.length === 0) {
      console.log(`⚠️ No hay adaptive formats con audio, intentando formatos regulares...`);
      audioFormats = info.streaming_data?.formats?.filter(f => 
        f.audio_codec
      ).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0)) || [];
    }

    // Fallback 2: Si aún no hay, intentar cualquier formato con codec de audio
    if (audioFormats.length === 0) {
      console.log(`⚠️ Sin formatos específicos, intentando cualquier formato disponible...`);
      audioFormats = [...(info.streaming_data?.adaptive_formats || []), ...(info.streaming_data?.formats || [])]
        .filter(f => f.audio_codec || f.video_codec)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    }

    if (!audioFormats || audioFormats.length === 0) {
      console.warn(`❌ No se encontraron formatos para ${videoId}`);
      return res.status(404).json({ error: 'No formats found' });
    }

    const format = audioFormats[0];
    let streamUrl = format.url;

    console.log(`✅ Formato seleccionado:`, {
      audioCodec: format.audio_codec,
      videoCodec: format.video_codec,
      bitrate: format.bitrate,
      hasCipher: !!format.cipher,
      hasUrl: !!format.url,
      mimeType: format.mime_type
    });

    // Si el formato requiere deciframiento
    if (format.cipher) {
      console.log(`🔐 Descifrando stream...`);
      streamUrl = await format.decipher(youtube.session.player);
      console.log(`✅ Stream descifrado correctamente`);
    }

    console.log(`✅ STREAM OBTENIDO: ${streamUrl.substring(0, 80)}...`);

    if (json === 'true') {
      res.json({ streamUrl });
    } else {
      // Si no pide JSON, hacer proxy del stream
      const response = await fetch(streamUrl, {
        headers: {
          'Referer': 'https://www.youtube.com/',
          'Origin': 'https://www.youtube.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
      });
      
      res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mp4');
      res.setHeader('Content-Length', response.headers.get('content-length'));
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      response.body.pipe(res);
    }
  } catch (error) {
    console.error("❌ ERROR OBTENIENDO STREAM YOUTUBE:", error.message);
    console.error("🔍 Error completo:", error);
    res.status(500).json({ error: 'Error interno', message: error.message });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let rooms = {};
const deleteTimeouts = {}; // Almacenamos los timeouts aquí para no contaminar el objeto rooms (evita crash circular de socket.io)

const manejarSalidaDeSala = (socket) => {
  for (let roomId in rooms) {
    const index = rooms[roomId].participantes.findIndex(p => p.socket_id === socket.id);
    if (index !== -1) {
      const usuarioQueSale = rooms[roomId].participantes[index];
      rooms[roomId].participantes.splice(index, 1);
      
      console.log(`🏃 USUARIO SALIÓ: ${usuarioQueSale.username} de sala ${roomId}`);

      const systemMsg = {
        id: `sys-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        username: 'Yale',
        text: `${usuarioQueSale.username} ha salido de la sala.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isSystem: true
      };
      io.to(roomId).emit('receive-message', systemMsg);

      if (rooms[roomId].participantes.length === 0) {
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
        if (usuarioQueSale.username === rooms[roomId].creador) {
          rooms[roomId].creador = rooms[roomId].participantes[0].username;
          console.log(`👑 NUEVO HOST: ${rooms[roomId].creador}`);
          io.to(roomId).emit('room-state', rooms[roomId]);
        }
        io.to(roomId).emit('participante-salio', rooms[roomId].participantes);
      }
      
      io.to('lobby').emit('lista-salas-actualizada', Object.values(rooms));
      socket.leave(roomId);
    }
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
      // Evitar duplicados si ya estaba
      const exist = rooms[roomId].participantes.find(p => p.socket_id === socket.id);
      if (!exist) {
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

  socket.on('video-state-change', ({ roomId, state, currentTime }) => {
    if (rooms[roomId]) {
      rooms[roomId].video_actual.state = state;
      rooms[roomId].video_actual.currentTime = currentTime;
      rooms[roomId].video_actual.lastUpdate = Date.now();
      socket.to(roomId).emit('video-state-update', { state, currentTime });
    }
  });

  socket.on('video-seek', ({ roomId, currentTime }) => {
    if (rooms[roomId]) {
      rooms[roomId].video_actual.currentTime = currentTime;
      rooms[roomId].video_actual.lastUpdate = Date.now();
      socket.to(roomId).emit('video-seek-update', currentTime);
    }
  });

  socket.on('change-video', ({ roomId, video }) => {
    if (rooms[roomId]) {
      rooms[roomId].video_actual = {
        ...video,
        state: 'PLAYING',
        currentTime: 0,
        lastUpdate: Date.now()
      };
      io.to(roomId).emit('room-state', rooms[roomId]);
    }
  });

  socket.on('leave-room', () => manejarSalidaDeSala(socket));
  socket.on('disconnect', () => manejarSalidaDeSala(socket));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log('====================================');
  console.log(`🚀 SERVIDOR YALE ACTIVO EN PUERTO ${PORT}`);
  console.log('====================================');
});
