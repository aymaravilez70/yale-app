// Configuración global del cliente móvil de Yale
const EXPO_PUBLIC_API_URL = process.env.EXPO_PUBLIC_API_URL;
const EXPO_PUBLIC_SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL;

// En desarrollo local con teléfono físico, la app necesita conectarse a la IP local de tu PC
// (por ejemplo: 'http://192.168.1.15:4000'). Si usas el emulador Android de Android Studio,
// la IP del host suele ser 'http://10.0.2.2:4000'.
const DEFAULT_DEV_URL = 'http://192.168.6.16:4000'; // IP física activa de tu PC en tu red local
const DEFAULT_PROD_URL = 'https://yale-app.onrender.com';

const API_BASE_URL = EXPO_PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? DEFAULT_PROD_URL : DEFAULT_DEV_URL);
const SOCKET_URL = EXPO_PUBLIC_SOCKET_URL || (process.env.NODE_ENV === 'production' ? DEFAULT_PROD_URL : DEFAULT_DEV_URL);

console.log("🔌 Yale Mobile API URL:", API_BASE_URL);
console.log("🔌 Yale Mobile Socket URL:", SOCKET_URL);

export { API_BASE_URL, SOCKET_URL };
