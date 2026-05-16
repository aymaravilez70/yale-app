import { io } from 'socket.io-client';

// URL del backend (ajustar si cambia en producción)
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

export const socket = io(SOCKET_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
});

// Listener básico para depuración inicial
socket.on('connect', () => {
    console.log('✅ Conectado al servidor de Yale (Socket ID):', socket.id);
});

socket.on('disconnect', () => {
    console.log('❌ Desconectado del servidor');
});

export default socket;
