import { io } from 'socket.io-client';
import { SOCKET_URL } from './config';

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
