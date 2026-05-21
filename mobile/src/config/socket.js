import { io } from 'socket.io-client';
import { SOCKET_URL } from './config';

export const socket = io(SOCKET_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,   // Reintentar siempre (no solo 5 veces)
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,       // Máximo 8s entre intentos
    timeout: 20000,
});

socket.on('connect', () => {
    console.log('✅ Conectado al servidor de Yale (Mobile Socket ID):', socket.id);
});

socket.on('disconnect', (reason) => {
    console.log('❌ Desconectado del servidor. Razón:', reason);
});

socket.on('reconnect', (attempt) => {
    console.log(`🔄 Reconectado al servidor después de ${attempt} intentos`);
});

socket.on('reconnect_attempt', (attempt) => {
    console.log(`🔁 Intento de reconexión #${attempt}...`);
});

export default socket;
