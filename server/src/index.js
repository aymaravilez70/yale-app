const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/youtube/search', async (req, res) => {
  const query = req.query.q;
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!query) return res.status(400).json({ error: 'Falta q' });
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=6&type=video&q=${encodeURIComponent(query)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    const results = data.items?.map(item => ({
      id: item.id.videoId,
      titulo: item.snippet.title,
      miniatura: item.snippet.thumbnails.high.url
    })) || [];
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/youtube/recommendations', async (req, res) => {
  const query = req.query.q || 'music';
  const apiKey = process.env.YOUTUBE_API_KEY;
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=16&type=video&q=${encodeURIComponent(query)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    const results = data.items?.map(item => ({
      id: item.id.videoId,
      titulo: item.snippet.title,
      miniatura: item.snippet.thumbnails.high.url
    })) || [];
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Error' });
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
