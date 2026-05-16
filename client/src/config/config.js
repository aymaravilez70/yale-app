// Configuración global del cliente
const isProd = import.meta.env.PROD;
const hostname = window.location.hostname;
const protocol = window.location.protocol;

// Si existe la variable de entorno, la usamos. 
// Si no, y estamos en localhost, usamos el puerto 4000.
// Si estamos en producción y no hay variable, intentamos usar el hostname actual (asumiendo misma URL).
const DEFAULT_URL = hostname === 'localhost' || hostname === '127.0.0.1' 
    ? `http://${hostname}:4000` 
    : `${protocol}//${hostname}`;

const API_BASE_URL = import.meta.env.VITE_API_URL || DEFAULT_URL;
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || DEFAULT_URL;

export { API_BASE_URL, SOCKET_URL };
