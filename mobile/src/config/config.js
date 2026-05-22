// Configuración global del cliente móvil de Yale
const EXPO_PUBLIC_API_URL = process.env.EXPO_PUBLIC_API_URL;
const EXPO_PUBLIC_SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL;

// Desarrollo: IP local. APK/release (EAS): Render vía env en eas.json o __DEV__ false.
const DEFAULT_DEV_URL = 'http://192.168.6.16:4000';
const DEFAULT_PROD_URL = 'https://yale-app.onrender.com';

const API_BASE_URL =
  EXPO_PUBLIC_API_URL || (__DEV__ ? DEFAULT_DEV_URL : DEFAULT_PROD_URL);
const SOCKET_URL =
  EXPO_PUBLIC_SOCKET_URL || EXPO_PUBLIC_API_URL || API_BASE_URL;

/** true = reproduce YouTube en el móvil (no usa proxy de Render). Más fiable. */
const YOUTUBE_DIRECT_PLAYBACK = process.env.EXPO_PUBLIC_YOUTUBE_DIRECT !== 'false';

console.log("🔌 Yale Mobile API URL:", API_BASE_URL);
console.log("🔌 Yale Mobile Socket URL:", SOCKET_URL);
console.log("▶️ YouTube directo (sin proxy servidor):", YOUTUBE_DIRECT_PLAYBACK);

export { API_BASE_URL, SOCKET_URL, YOUTUBE_DIRECT_PLAYBACK };
