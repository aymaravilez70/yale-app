/**
 * Sync en sala (estilo watch-party).
 * Regla: intervalos cortos mientras PLAYING; en PAUSA el cliente no hace heartbeat/sync.
 */
export const PLAYBACK_SYNC = {
  /** Desfase máximo antes de corregir posición (segundos) */
  DRIFT_SEC: 0.9,
  /** Corrección fina en el <video> del WebView */
  DRIFT_HTML_SEC: 0.35,
  /** Invitados YouTube — ~1 s: buen equilibrio sync/batería */
  GUEST_INTERVAL_MS: 1000,
  /** Invitados Kick/navegador — más frecuente (sin reloj de servidor tan estable) */
  GUEST_INTERVAL_BROWSER_MS: 500,
  /** Host YouTube — autoridad de sala cada ~1,6 s */
  HOST_HEARTBEAT_MS: 1600,
  /** Host Kick/navegador */
  HOST_HEARTBEAT_BROWSER_MS: 900,
  STREAM_MAX_AUTO_RETRIES: 3,
  STREAM_RETRY_DELAYS_MS: [1200, 3000, 6000],
};

/** Alias legacy — evita ReferenceError si queda caché antiguo en Metro */
export const GUEST_SYNC_INTERVAL_MS = PLAYBACK_SYNC.GUEST_INTERVAL_MS;
export const GUEST_SYNC_DRIFT_THRESHOLD = PLAYBACK_SYNC.DRIFT_SEC;
export const HOST_HEARTBEAT_MS = PLAYBACK_SYNC.HOST_HEARTBEAT_MS;
