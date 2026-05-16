// Configuración global del cliente
const API_BASE_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:4000`;
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || `http://${window.location.hostname}:4000`;

export { API_BASE_URL, SOCKET_URL };
