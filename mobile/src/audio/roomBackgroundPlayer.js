import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { API_BASE_URL } from '../config/config';
import { PLAYBACK_SYNC } from '../constants/playbackSync';
import {
  MediaControl,
  PlaybackState,
  Command,
} from 'expo-media-control';

let streamSound = null;
let loadedStreamUrl = null;
let mediaListenerRemove = null;
let controlCallbacks = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isBackgroundPlaybackActive() {
  return !!streamSound;
}

export function buildStreamUrl(videoId) {
  return `${API_BASE_URL}/api/youtube/stream?videoId=${encodeURIComponent(videoId)}`;
}

export async function setupRoomAudioSession() {
  await Audio.setAudioModeAsync({
    staysActiveInBackground: true,
    playsInSilentModeIOS: true,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
  });
}

export async function initMediaSession(callbacks = {}) {
  controlCallbacks = callbacks;
  await setupRoomAudioSession();

  try {
    await MediaControl.enableMediaControls({
      capabilities: [Command.PLAY, Command.PAUSE, Command.SEEK],
      compactCapabilities: [Command.PLAY, Command.PAUSE],
      notification: {
        color: '#6366f1',
        showWhenClosed: true,
      },
    });

    if (mediaListenerRemove) mediaListenerRemove();
    mediaListenerRemove = MediaControl.addListener((event) => {
      if (event.command === Command.PLAY) {
        controlCallbacks?.onPlayPress?.();
      } else if (event.command === Command.PAUSE) {
        controlCallbacks?.onPausePress?.();
      } else if (event.command === Command.SEEK && event.data?.position != null) {
        controlCallbacks?.onSeek?.(event.data.position);
      }
    });
  } catch (e) {
    console.warn('[roomBackgroundPlayer] initMediaSession:', e?.message || e);
  }
}

export async function updateMediaSession({
  title,
  artist,
  artworkUri,
  durationSec = 0,
  positionSec = 0,
  isPlaying = false,
}) {
  try {
    const enabled = await MediaControl.isEnabled();
    if (!enabled) return;

    await MediaControl.updateMetadata({
      title: title || 'Yale',
      artist: artist || 'Yale',
      album: 'Yale',
      artwork: artworkUri ? { uri: artworkUri } : undefined,
      duration: durationSec > 0 ? Math.round(durationSec) : undefined,
    });
    await MediaControl.updatePlaybackState(
      isPlaying ? PlaybackState.PLAYING : PlaybackState.PAUSED,
      Math.max(0, positionSec),
      1
    );
  } catch (e) {
    console.warn('[roomBackgroundPlayer] updateMediaSession:', e?.message || e);
  }
}

export async function teardownMediaSession() {
  await unloadStreamSound();
  if (mediaListenerRemove) {
    mediaListenerRemove();
    mediaListenerRemove = null;
  }
  try {
    await MediaControl.disableMediaControls();
  } catch (_) {}
  controlCallbacks = null;
}

async function unloadStreamSound() {
  if (!streamSound) return;
  try {
    await streamSound.stopAsync();
    await streamSound.unloadAsync();
  } catch (_) {}
  streamSound = null;
  loadedStreamUrl = null;
}

/** Pausa el audio nativo sin descargarlo (YouTube en sala). */
export async function pauseNativeStream() {
  if (!streamSound) return;
  try {
    const status = await streamSound.getStatusAsync();
    if (status.isLoaded && status.isPlaying) {
      await streamSound.pauseAsync();
    }
  } catch (_) {}
}

/** Detiene audio nativo (YouTube) — obligatorio al usar Kick/navegador embed. */
export async function stopNativeStream() {
  await unloadStreamSound();
  try {
    const enabled = await MediaControl.isEnabled();
    if (enabled) {
      await MediaControl.updatePlaybackState(PlaybackState.PAUSED, 0, 1);
    }
  } catch (_) {}
}

function onStreamStatusUpdate(status) {
  if (!status?.isLoaded || !controlCallbacks?.onStatus) return;
  controlCallbacks.onStatus({
    positionSec: (status.positionMillis || 0) / 1000,
    durationSec: (status.durationMillis || 0) / 1000,
    isPlaying: status.isPlaying === true,
  });
}

/** Precarga el stream en memoria para transiciones sin cortes. */
export async function preloadStream(streamUrl) {
  if (!streamUrl) return;
  if (streamSound && loadedStreamUrl === streamUrl) {
    try {
      const st = await streamSound.getStatusAsync();
      if (st.isLoaded) return;
    } catch (_) {}
  }

  await unloadStreamSound();
  try {
    const { sound } = await Audio.Sound.createAsync(
      { uri: streamUrl },
      {
        shouldPlay: false,
        progressUpdateIntervalMillis: 400,
      },
      onStreamStatusUpdate
    );
    streamSound = sound;
    loadedStreamUrl = streamUrl;
  } catch (e) {
    console.warn('[roomBackgroundPlayer] preloadStream:', e?.message || e);
  }
}

async function waitUntilPlaying(shouldPlay, maxMs = 2500) {
  if (!shouldPlay || !streamSound) return true;
  const steps = Math.ceil(maxMs / 50);
  for (let i = 0; i < steps; i++) {
    try {
      const st = await streamSound.getStatusAsync();
      if (st.isLoaded && st.isPlaying) return true;
    } catch (_) {}
    await sleep(50);
  }
  return false;
}

/**
 * Audio principal (expo-av). El WebView solo muestra video en mute.
 */
export async function ensureStreamPlayback({ streamUrl, positionSec = 0, shouldPlay = true }) {
  if (!streamUrl) return false;

  try {
    if (!streamSound || loadedStreamUrl !== streamUrl) {
      await preloadStream(streamUrl);
    }
    if (!streamSound) return false;

    const posMs = Math.max(0, positionSec) * 1000;
    await streamSound.setPositionAsync(posMs);

    if (shouldPlay) {
      await streamSound.playAsync();
      await waitUntilPlaying(true);
    } else {
      await streamSound.pauseAsync();
    }
    return true;
  } catch (e) {
    console.warn('[roomBackgroundPlayer] ensureStreamPlayback:', e?.message || e);
    return false;
  }
}

export async function syncStreamPlayback(positionSec, shouldPlay, { allowPause = true } = {}) {
  if (!streamSound) return;
  try {
    const status = await streamSound.getStatusAsync();
    if (!status.isLoaded) return;

    const drift = Math.abs((status.positionMillis || 0) / 1000 - positionSec);
    if (drift > PLAYBACK_SYNC.DRIFT_HTML_SEC) {
      await streamSound.setPositionAsync(Math.max(0, positionSec) * 1000);
    }

    if (shouldPlay && !status.isPlaying) {
      await streamSound.playAsync();
    } else if (!shouldPlay && allowPause && status.isPlaying) {
      await streamSound.pauseAsync();
    }
  } catch (_) {}
}

/** Fuerza reanudar el audio nativo (p. ej. tras pausa espuria del WebView en segundo plano). */
export async function keepNativePlaying(positionSec) {
  await setupRoomAudioSession();
  if (!streamSound) return false;
  try {
    const status = await streamSound.getStatusAsync();
    if (!status.isLoaded) return false;
    if (positionSec != null && Number.isFinite(positionSec)) {
      const drift = Math.abs((status.positionMillis || 0) / 1000 - positionSec);
      if (drift > PLAYBACK_SYNC.DRIFT_SEC) {
        await streamSound.setPositionAsync(Math.max(0, positionSec) * 1000);
      }
    }
    if (!status.isPlaying) {
      await streamSound.playAsync();
      await waitUntilPlaying(true, 3000);
    }
    return true;
  } catch (e) {
    console.warn('[roomBackgroundPlayer] keepNativePlaying:', e?.message || e);
    return false;
  }
}

export async function getStreamPositionSec() {
  if (!streamSound) return null;
  try {
    const status = await streamSound.getStatusAsync();
    if (status.isLoaded) return (status.positionMillis || 0) / 1000;
  } catch (_) {}
  return null;
}

/** @deprecated alias */
export const startBackgroundPlayback = ensureStreamPlayback;
export const stopBackgroundPlayback = stopNativeStream;
export const setBackgroundPlaying = async (shouldPlay) => {
  if (!streamSound) return;
  try {
    const status = await streamSound.getStatusAsync();
    if (!status.isLoaded) return;
    if (shouldPlay && !status.isPlaying) await streamSound.playAsync();
    if (!shouldPlay && status.isPlaying) await streamSound.pauseAsync();
  } catch (_) {}
};
export const syncBackgroundPosition = syncStreamPlayback;
export const getBackgroundPositionSec = getStreamPositionSec;
