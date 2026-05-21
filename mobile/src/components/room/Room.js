import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Text, View, TextInput, TouchableOpacity, Pressable, Image, ScrollView, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal, BackHandler, StyleSheet, StatusBar as RNStatusBar, Animated, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { Send, ChevronLeft, Users, MessageSquare, Lock, Play, Pause, Search, X, Globe, Smile, Settings, Maximize2, Minimize2 } from 'lucide-react-native';
import socket from '../../config/socket';
import { API_BASE_URL } from '../../config/config';
import MiniBrowser from './MiniBrowser';
import * as Notifications from 'expo-notifications';


const enviarNotificacionLocal = async (titulo, cuerpo) => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: titulo,
        body: cuerpo,
        sound: true, // Esto activará el sonido nativo de Android
      },
      trigger: null, // null significa que se dispara de forma inmediata
    });
  } catch (e) {
    console.warn("Error enviando notificación local:", e);
  }
};

const adBlockedDomains = [];

const getCalculatedVideoTime = (videoActual) => {
  if (!videoActual) return 0;
  let time = videoActual.currentTime || 0;
  if (videoActual.state === 'PLAYING' && videoActual.lastUpdate) {
    time += (Date.now() - videoActual.lastUpdate) / 1000;
  }
  return time;
};

const formatPlayerTime = (seconds) => {
  if (!seconds || !Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const SYNC_INTERVAL_MS = 500;
const SYNC_DRIFT_THRESHOLD = 0.6;
const GUEST_SYNC_DRIFT_THRESHOLD = 1.1;
const HOST_HEARTBEAT_MS = 1200;
const GUEST_SYNC_INTERVAL_MS = 900;
const CONTROLS_HIDE_MS = 4500;
const UI_TICK_MS = 200;

// HTML estático: no incluir isHost aquí o el WebView se recarga al cambiar de admin
const HTML_PLAYER_SOURCE = {
  html: `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    body, html {
      margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background-color: black;
      display: flex; align-items: center; justify-content: center;
    }
    video { width: 100%; height: 100%; object-fit: contain; }
  </style>
</head>
<body>
  <video id="player" playsinline webkit-playsinline></video>
  <script>
    const player = document.getElementById('player');
    window.__yaleIsHost = false;
    window.__yalePlaying = true;

    player.onplaying = () => window.ReactNativeWebView.postMessage(JSON.stringify({type: 'PLAYING', time: player.currentTime}));
    player.onpause = () => window.ReactNativeWebView.postMessage(JSON.stringify({type: 'PAUSED', time: player.currentTime}));
    player.onended = () => window.ReactNativeWebView.postMessage(JSON.stringify({type: 'ENDED'}));
    player.ontimeupdate = () => window.ReactNativeWebView.postMessage(JSON.stringify({type: 'TIME', time: player.currentTime}));
    player.onerror = () => window.ReactNativeWebView.postMessage(JSON.stringify({type: 'ERROR', code: player.error ? player.error.code : 'unknown'}));
    player.controls = false;
    player.removeAttribute('controls');

    function postTimeTick() {
      const dur = player.duration && isFinite(player.duration) ? player.duration : 0;
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'TIME',
        time: player.currentTime || 0,
        duration: dur
      }));
    }

    player.addEventListener('loadedmetadata', function() {
      postTimeTick();
    });
    player.addEventListener('durationchange', function() {
      postTimeTick();
    });

    setInterval(function() {
      if (!player.paused && !player.ended) postTimeTick();
    }, 250);

    function handleMessage(data) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'SET_ROLE') {
          window.__yaleIsHost = !!msg.isHost;
          window.__yalePlaying = msg.playing !== false;
          if (msg.playing && player.paused) {
            player.play().catch(function() {
              player.muted = true;
              player.play().then(function() { setTimeout(function() { player.muted = false; }, 300); }).catch(function() {});
            });
          }
          return;
        }
        if (msg.type === 'SYNC') {
          const target = typeof msg.time === 'number' ? msg.time : 0;
          const drift = Math.abs(player.currentTime - target);
          if (drift > 0.25 && target >= 0) player.currentTime = target;
          if (msg.playing && player.paused) {
            player.play().catch(function() {
              player.muted = true;
              player.play().then(function() { setTimeout(function() { player.muted = false; }, 300); }).catch(function() {});
            });
          } else if (msg.playing === false && !player.paused) {
            player.pause();
          }
          return;
        }
        if (msg.type === 'SEEK_INITIAL') {
          if (msg.time > 0) player.currentTime = msg.time;
          if (msg.autoplay) {
            player.play().catch(function() {
              player.muted = true;
              player.play().then(function() { setTimeout(function() { player.muted = false; }, 300); }).catch(function() {});
            });
          }
          return;
        }
        if (msg.type === 'LOAD') {
          player.src = msg.url;
          const targetStartTime = msg.startTime || 0;
          const onMetadataLoaded = () => {
            if (targetStartTime > 0) player.currentTime = targetStartTime;
            player.removeEventListener('loadedmetadata', onMetadataLoaded);
          };
          player.addEventListener('loadedmetadata', onMetadataLoaded);
          player.load();
          if (msg.autoplay) player.play().catch(function() {});
        } else if (msg.type === 'PLAY') {
          player.play().catch(function() {});
        } else if (msg.type === 'PAUSE') {
          player.pause();
        } else if (msg.type === 'SEEK') {
          if (Math.abs(player.currentTime - msg.time) > 0.5) player.currentTime = msg.time;
          postTimeTick();
        } else if (msg.type === 'GET_TIME') {
          postTimeTick();
        }
      } catch (err) {}
    }

    document.addEventListener('message', (e) => handleMessage(e.data));
    window.addEventListener('message', (e) => handleMessage(e.data));
  </script>
</body>
</html>`
};

const Room = ({ roomId, user, onLeave }) => {
  const [roomData, setRoomData] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [playerReady, setPlayerReady] = useState(false);
  const [playing, setPlaying] = useState(true);

  const isHost = user?.username === roomData?.creador;
  const isBrowserSync = roomData?.video_actual?.id === 'browser_sync';

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [activeReactionMenuId, setActiveReactionMenuId] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const [showMiniBrowser, setShowMiniBrowser] = useState(false);
  const [showYtBrowser, setShowYtBrowser] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [queue, setQueue] = useState([]);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [displayTime, setDisplayTime] = useState(0);

  const lastSeenTitleRef = useRef('');
  const [showPlayerControls, setShowPlayerControls] = useState(true);
  const progressBarWidthRef = useRef(0);
  const hideControlsTimerRef = useRef(null);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const lastUiTimeRef = useRef(0);
  const isHostRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    isHostRef.current = user?.username === roomData?.creador;
  }, [user?.username, roomData?.creador]);

  // 🔵 SEGUNDO PLANO: AppState — detectar cuando la app va al fondo y vuelve
  useEffect(() => {
    if (!roomId || !user) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'active' && prevState !== 'active') {
        // Volvió al primer plano → re-unirse a la sala si el socket está conectado
        console.log('📱 App volvió al primer plano. Re-uniéndose a la sala...');
        if (socket.connected) {
          socket.emit('join-room', { roomId, user });
        } else {
          // Si el socket no está conectado, esperar a que se reconecte
          socket.connect();
        }
      } else if (nextState === 'background') {
        console.log('📱 App fue al segundo plano. La sala sigue activa en el servidor.');
        // NO emitir leave-room — el servidor tiene 45s de debounce
      }
    });

    return () => subscription.remove();
  }, [roomId, user]);

  // 🔵 SEGUNDO PLANO: socket reconnect — re-unirse automáticamente
  useEffect(() => {
    if (!roomId || !user) return;

    const handleReconnect = () => {
      console.log('🔄 Socket reconectado. Re-uniéndose a la sala:', roomId);
      socket.emit('join-room', { roomId, user });
    };

    socket.io.on('reconnect', handleReconnect);
    return () => {
      socket.io.off('reconnect', handleReconnect);
    };
  }, [roomId, user]);

  const hidePlayerControls = useCallback(() => {
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
    Animated.timing(controlsOpacity, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setShowPlayerControls(false));
  }, [controlsOpacity]);

  const bumpPlayerControls = useCallback(() => {
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    setShowPlayerControls(true);
    controlsOpacity.setValue(1);
    hideControlsTimerRef.current = setTimeout(hidePlayerControls, CONTROLS_HIDE_MS);
  }, [controlsOpacity, hidePlayerControls]);

  useEffect(() => {
    const pct = videoDuration > 0 ? Math.min(1, displayTime / videoDuration) : 0;
    if (isHostRef.current) {
      Animated.timing(progressAnim, {
        toValue: pct,
        duration: 100,
        useNativeDriver: false,
      }).start();
    } else {
      progressAnim.setValue(pct);
    }
  }, [displayTime, videoDuration, progressAnim]);

  useEffect(() => {
    return () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    };
  }, []);

  const ytInjectedScript = `
    (function() {
      var lastSentVideoId = null;
      function checkYoutubeVideo() {
        var url = window.location.href;
        if (url.indexOf('watch?v=') !== -1) {
          var match = url.match(/[?&]v=([^&]+)/);
          var videoId = match ? match[1] : null;
          if (videoId && videoId !== lastSentVideoId) {
            lastSentVideoId = videoId;
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'YOUTUBE_VIDEO_DETECTED',
              id: videoId
            }));
          }
        }
        // NO reseteamos lastSentVideoId cuando no hay watch?v=
        // para evitar duplicados durante navegaciones intermedias
      }
      
      setInterval(checkYoutubeVideo, 1000);
      checkYoutubeVideo();
    })();
    true;
  `;

  const beforeContentScript = `
    (function() {
      if (window.__yaleConsoleInjected) return;
      window.__yaleConsoleInjected = true;

      const origLog = console.log;
      const origWarn = console.warn;
      const origError = console.error;

      function sendToNative(type, args) {
        try {
          const message = args.map(arg => {
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
            if (typeof arg === 'object') {
              try { return JSON.stringify(arg); } catch(e) { return String(arg); }
            }
            return String(arg);
          }).join(' ');

          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'CONSOLE_LOG',
            message: '[' + type + '] [' + (window.self === window.top ? 'MainFrame' : 'Iframe: ' + window.location.host) + '] ' + message
          }));
        } catch(e) {}
      }

      console.log = function(...args) {
        origLog.apply(console, args);
        sendToNative('LOG', args);
      };
      console.warn = function(...args) {
        origWarn.apply(console, args);
        sendToNative('WARN', args);
      };
      console.error = function(...args) {
        origError.apply(console, args);
        sendToNative('ERROR', args);
      };

      window.addEventListener('error', function(e) {
        sendToNative('UNHANDLED_ERROR', [e.message, 'at', e.filename, ':', e.lineno]);
      });

      // --- NATIVE DIALOG BYPASS (CONFIRM / ALERT SHIELD) ---
      try {
        window.confirm = function(msg) {
          console.log("🛡️ [Yale Dialog Shield] Interceptado window.confirm('" + msg + "'). Retornando true (Aceptar/Continuar automáticamente para evitar pausa).");
          return true;
        };
        window.alert = function(msg) {
          console.log("🛡️ [Yale Dialog Shield] Interceptado window.alert('" + msg + "'). Ignorado de forma automática.");
          return true;
        };
        window.prompt = function(msg) {
          console.log("🛡️ [Yale Dialog Shield] Interceptado window.prompt('" + msg + "'). Retornando null de forma automática.");
          return null;
        };
        console.log("🛡️ [Yale Dialog Shield] window.confirm/alert/prompt sobreescritos con éxito.");
      } catch(dialogErr) {
        console.warn("⚠️ No se pudo inicializar Yale Dialog Shield:", dialogErr.message);
      }

      // --- CAPA DE HOOK DE JWPLAYER (JWPLAYER SHIELD) ---
      try {
        let origJwplayer = undefined;
        Object.defineProperty(window, 'jwplayer', {
          get: function() {
            if (!origJwplayer) return undefined;
            return function(id) {
              const playerInstance = origJwplayer(id);
              if (playerInstance && !playerInstance.__yaleHooked) {
                playerInstance.__yaleHooked = true;
                const origSetup = playerInstance.setup;
                if (typeof origSetup === 'function') {
                  playerInstance.setup = function(options) {
                    console.log("🎯 [Yale JWPlayer Hook] Interceptada configuración de JWPlayer. Forzando doNotSaveCookies...");
                    if (options) {
                      options.doNotSaveCookies = true;
                      if (options.advertising) {
                        console.log("⚡ [Yale JWPlayer Hook] Desactivando publicidad detectada en setup.");
                        delete options.advertising;
                      }
                    }
                    return origSetup.apply(this, arguments);
                  };
                }
              }
              return playerInstance;
            };
          },
          set: function(val) {
            origJwplayer = val;
          },
          configurable: true,
          enumerable: true
        });
      } catch(jwErr) {
        console.warn("⚠️ No se pudo inicializar Yale JWPlayer Hook:", jwErr.message);
      }

      // --- CAPA DE PROTECCIÓN AGRESIVA DE ALMACENAMIENTO DE YALE (STORAGE SHIELD) ---
      try {
        console.log("🛡️ [Yale Storage Shield] Activando escudo de almacenamiento agresivo...");
        
        // Limpiar todo lo existente de forma inmediata
        try { localStorage.clear(); } catch(e) {}
        try { sessionStorage.clear(); } catch(e) {}
        
        // Interceptar Storage.prototype para bloquear todos los sets/gets completamente
        if (window.Storage) {
          Storage.prototype.getItem = function(key) {
            console.log("🚫 [Storage.prototype.getItem] Bloqueada lectura para key: " + key);
            return null;
          };
          Storage.prototype.setItem = function(key, val) {
            console.log("🚫 [Storage.prototype.setItem] Bloqueada escritura para key: " + key);
          };
          Storage.prototype.removeItem = function(key) {
            console.log("🚫 [Storage.prototype.removeItem] Bloqueado removeItem para: " + key);
          };
          Storage.prototype.clear = function() {
            console.log("🚫 [Storage.prototype.clear] Bloqueado clear");
          };
        }
        
        // Redefinir window.localStorage y window.sessionStorage
        const dummyStorage = {
          getItem: function() { return null; },
          setItem: function() {},
          removeItem: function() {},
          clear: function() {},
          key: function() { return null; },
          length: 0
        };
        try {
          Object.defineProperty(window, 'localStorage', {
            get: function() { return dummyStorage; },
            set: function() {},
            configurable: true
          });
        } catch(e) {}
        try {
          Object.defineProperty(window, 'sessionStorage', {
            get: function() { return dummyStorage; },
            set: function() {},
            configurable: true
          });
        } catch(e) {}

        // Desactivar IndexedDB para evitar persistencia alternativa de reanudación
        try {
          Object.defineProperty(window, 'indexedDB', {
            get: function() { return null; },
            set: function() {},
            configurable: true
          });
          console.log("🚫 [Yale Storage Shield] IndexedDB desactivado con éxito.");
        } catch(e) {}

        // Desactivar WebSQL
        try {
          window.openDatabase = null;
          console.log("🚫 [Yale Storage Shield] WebSQL desactivado con éxito.");
        } catch(e) {}
      } catch(storageErr) {
        console.warn("⚠️ No se pudo inicializar Yale Storage Shield:", storageErr.message);
      }

      // --- CAPA DE PROTECCIÓN DE COOKIES DE YALE (COOKIE SHIELD) ---
      try {
        console.log("🛡️ [Yale Cookie Shield] Activando escudo...");
        let descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
        if (!descriptor && window.HTMLDocument) {
          descriptor = Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
        }
        if (!descriptor) {
          descriptor = Object.getOwnPropertyDescriptor(document, 'cookie');
        }
        
        if (descriptor && descriptor.configurable) {
          const origCookieGet = descriptor.get;
          const origCookieSet = descriptor.set;
          
          Object.defineProperty(document, 'cookie', {
            get: function() {
              return origCookieGet ? origCookieGet.call(document) : '';
            },
            set: function(val) {
              if (typeof val === 'string') {
                const parts = val.split(';');
                const firstPart = parts[0] || '';
                const eqPos = firstPart.indexOf('=');
                const name = eqPos > -1 ? firstPart.substr(0, eqPos).trim() : firstPart.trim();
                const value = eqPos > -1 ? firstPart.substr(eqPos + 1).trim() : '';
                
                const lowerName = name.toLowerCase();
                const lowerValue = value.toLowerCase();
                
                // Permitir cookies de Cloudflare de forma explícita para no romper el sitio
                const isCF = name.startsWith('__cf') || name.startsWith('cf_') || lowerName.includes('cloudflare');
                if (isCF) {
                  if (origCookieSet) origCookieSet.call(document, val);
                  return;
                }

                // Extraer id del video de la URL actual para bloquear cookies basadas en el ID
                let videoId = '';
                try {
                  const pathParts = window.location.pathname.split('/');
                  videoId = pathParts[pathParts.length - 1] || '';
                } catch(e) {}

                const isNumeric = !isNaN(value) && value !== '';
                const hasVideoId = videoId && (lowerName.includes(videoId) || lowerValue.includes(videoId));
                const isSuspicious = 
                  lowerName.includes('resume') || lowerName.includes('time') || 
                  lowerName.includes('pos') || lowerName.includes('progress') ||
                  lowerName.includes('history') || lowerName.includes('jwplayer') ||
                  lowerName.includes('position') || lowerName.includes('current') || 
                  lowerName.includes('duration') || lowerName.includes('playback') ||
                  lowerName.includes('cuevana') || isNumeric || hasVideoId;

                if (isSuspicious) {
                  console.log("🚫 [Yale Cookie Shield] Bloqueada escritura de cookie sospechosa: " + name + "=" + value);
                  return;
                }
              }
              if (origCookieSet) origCookieSet.call(document, val);
            },
            configurable: true,
            enumerable: true
          });
        }

        // Limpiar todas las cookies de la página que no sean de Cloudflare
        try {
          const cookies = document.cookie.split(";");
          for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i];
            const eqPos = cookie.indexOf("=");
            const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
            const isCF = name.startsWith('__cf') || name.startsWith('cf_') || name.toLowerCase().includes('cloudflare');
            if (!isCF) {
              document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
              document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;domain=" + window.location.hostname + ";path=/";
              console.log("🧹 [Yale Cookie Shield] Borrada cookie existente: " + name);
            }
          }
        } catch(e) {}
      } catch(cookieErr) {
        console.warn("⚠️ No se pudo inicializar Yale Cookie Shield:", cookieErr.message);
      }
      
      console.log("🌐 Yale Console Logger (Room) inicializado en: " + window.location.href);
    })();
    true;
  `;

  const adBlockScript = `
    true;
  `;

  // Modo sitio web: reproductor nativo + sync + autoplay + saltar anuncios
  const browserNativeSyncScript = `
    (function() {
      window.__yaleIsHost = false;
      window.__yalePlaying = true;
      window.__yaleRemoteSync = false;
      window.__yaleAutoStarted = false;

      function post(obj) {
        try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(e) {}
      }

      function getJw() {
        try {
          if (typeof jwplayer === 'function') {
            var p = jwplayer();
            if (p && typeof p.getPosition === 'function') return p;
          }
        } catch(e) {}
        return null;
      }

      function getBestVideo() {
        var videos = document.querySelectorAll('video');
        var best = null;
        for (var i = 0; i < videos.length; i++) {
          var v = videos[i];
          if (!best) { best = v; continue; }
          if (!v.paused && best.paused) best = v;
          else if (v.readyState > best.readyState) best = v;
        }
        return best;
      }

      function getTime() {
        var jw = getJw();
        if (jw) return jw.getPosition() || 0;
        var v = getBestVideo();
        return v ? (v.currentTime || 0) : 0;
      }

      function getDuration() {
        var jw = getJw();
        if (jw) return jw.getDuration() || 0;
        var v = getBestVideo();
        return v && isFinite(v.duration) ? v.duration : 0;
      }

      function doPlay() {
        var jw = getJw();
        if (jw) { try { jw.play(); return; } catch(e) {} }
        var v = getBestVideo();
        if (v) v.play().catch(function() {});
      }

      function doPause() {
        var jw = getJw();
        if (jw) { try { jw.pause(); return; } catch(e) {} }
        var v = getBestVideo();
        if (v) v.pause();
      }

      function doSeek(t) {
        var jw = getJw();
        if (jw) { try { jw.seek(t); return; } catch(e) {} }
        var v = getBestVideo();
        if (v) v.currentTime = t;
      }

      function hideBigPlayOverlays() {
        var v = getBestVideo();
        var isPlaying = v && (!v.paused || (v.currentTime && v.currentTime > 0.4));
        var jw = getJw();
        if (jw) {
          try {
            var st = jw.getState && jw.getState();
            if (st === 'playing' || st === 'buffering') isPlaying = true;
          } catch(e) {}
        }
        if (!document.getElementById('yale-hide-play-css')) {
          var s = document.createElement('style');
          s.id = 'yale-hide-play-css';
          s.textContent = [
            '.vjs-big-play-button, .jw-display, .jw-display-icon-container,',
            '.jw-icon-playback, [class*="big-play"], [class*="play-overlay"],',
            '[class*="poster-play"], .ytp-large-play-button, .plyr__control--overlaid,',
            'button[aria-label="Play"], .play-btn-overlay {',
            'opacity:0!important;visibility:hidden!important;pointer-events:none!important;display:none!important;}',
            '.yale-isolated-video {',
            '  position: fixed !important;',
            '  top: 0 !important;',
            '  left: 0 !important;',
            '  width: 100% !important;',
            '  height: 100% !important;',
            '  z-index: 2147483647 !important;',
            '  background-color: black !important;',
            '  object-fit: contain !important;',
            '}',
            '.jw-controlbar, .jw-controls, .vjs-control-bar, .plyr__controls, video::-webkit-media-controls {',
            '  display: none !important;',
            '  opacity: 0 !important;',
            '  visibility: hidden !important;',
            '  pointer-events: none !important;',
            '}',
            'body, html {',
            '  overflow: hidden !important;',
            '}'
          ].join(' ');
          document.head.appendChild(s);
        }
      }

      function runAdSkipper() {
        try {
          var adTextPatterns = [/skip ad/i, /saltar anuncio/i, /this ad will end/i, /anuncio/i, /publicidad/i, /advertisement/i, /omitir/i];
          var videos = document.querySelectorAll('video');
          var isAdActive = false;
          var skipButton = null;

          document.querySelectorAll('div, span, button, a, [role="button"]').forEach(function(el) {
            var text = (el.innerText || el.textContent || '').trim();
            if (!text) return;
            for (var i = 0; i < adTextPatterns.length; i++) {
              if (adTextPatterns[i].test(text)) {
                isAdActive = true;
                if (/skip/i.test(text) || /saltar/i.test(text) || /omitir/i.test(text)) {
                  skipButton = el;
                }
                break;
              }
            }
          });

          if (isAdActive) {
            videos.forEach(function(v) {
              if (!v.paused && v.duration > 0) {
                if (v.__yaleOrigMuted === undefined) v.__yaleOrigMuted = v.muted;
                v.playbackRate = 16;
                v.muted = true;
              }
            });
          } else {
            videos.forEach(function(v) {
              if (v.playbackRate > 2) {
                v.playbackRate = 1;
                if (v.__yaleOrigMuted !== undefined) {
                  v.muted = v.__yaleOrigMuted;
                  delete v.__yaleOrigMuted;
                }
              }
            });
          }

          if (skipButton && !skipButton.__yaleSkipClicked) {
            skipButton.__yaleSkipClicked = true;
            try { skipButton.click(); } catch(e) {}
          }
        } catch(e) {}
      }

      function autoClickPlayAndResume() {
        if (window.__yaleRemoteSync) return;
        var playTexts = [/reproducir/i, /^play$/i, /ver ahora/i, /continuar/i, /reanudar/i, /resume/i, /start watch/i];
        document.querySelectorAll('button, a, [role="button"], .btn, .vjs-big-play-button, .jw-icon-playback').forEach(function(el) {
          if (el.__yalePlayClicked) return;
          var text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
          var match = false;
          for (var i = 0; i < playTexts.length; i++) {
            if (playTexts[i].test(text)) { match = true; break; }
          }
          if (!match && el.className && /big-play|play-button|vjs-big-play|jw-display/i.test(el.className)) match = true;
          if (match) {
            var r = el.getBoundingClientRect();
            if (r.width > 20 && r.height > 20) {
              el.__yalePlayClicked = true;
              try { el.click(); } catch(e) {}
            }
          }
        });
      }

      function autoStartPlayback() {
        if (window.__yaleAutoStarted) return;
        autoClickPlayAndResume();
        doPlay();
        var v = getBestVideo();
        if (v && (v.currentTime > 0.3 || !v.paused)) {
          window.__yaleAutoStarted = true;
        }
        var jw = getJw();
        if (jw) {
          try {
            var st = jw.getState && jw.getState();
            if (st === 'playing' || st === 'buffering') window.__yaleAutoStarted = true;
          } catch(e) {}
        }
      }

      function attachVideo(v) {
        if (!v || v.__yaleSyncAttached) return;
        v.__yaleSyncAttached = true;

        // Evitar doble click para evitar controles nativos o fullscreen nativo
        v.addEventListener('dblclick', function(e) {
          e.preventDefault();
          e.stopPropagation();
        }, true); // fase de captura

        // Capturar click para alternar visibilidad de los controles premium de Yale
        v.addEventListener('click', function(e) {
          post({ type: 'PLAYER_TAP' });
        }, true); // fase de captura

        var reportPlay = function() {
          if (window.__yaleRemoteSync) return;
          hideBigPlayOverlays();
          post({ type: 'PLAYING', time: getTime(), duration: getDuration() });
        };
        var reportPause = function() {
          if (window.__yaleRemoteSync) return;
          post({ type: 'PAUSED', time: getTime(), duration: getDuration() });
        };
        v.addEventListener('play', reportPlay);
        v.addEventListener('playing', reportPlay);
        v.addEventListener('pause', reportPause);
        v.addEventListener('timeupdate', function() {
          hideBigPlayOverlays();
          post({ type: 'TIME', time: v.currentTime || 0, duration: getDuration() });
        });
      }

      try {
        if (typeof jwplayer === 'function') {
          var jw = jwplayer();
          if (jw && jw.on) {
            jw.on('play', function() {
              if (window.__yaleRemoteSync) return;
              hideBigPlayOverlays();
              post({ type: 'PLAYING', time: getTime(), duration: getDuration() });
            });
            jw.on('pause', function() {
              if (window.__yaleRemoteSync) return;
              post({ type: 'PAUSED', time: getTime(), duration: getDuration() });
            });
            jw.on('time', function() {
              hideBigPlayOverlays();
              post({ type: 'TIME', time: getTime(), duration: getDuration() });
            });
          }
        }
      } catch(e) {}

      function remoteSync(msg) {
        window.__yaleRemoteSync = true;
        try {
          if (msg.playing === false) doPause();
          else if (msg.playing === true) doPlay();
          if (typeof msg.time === 'number' && msg.time >= 0) {
            var drift = Math.abs(getTime() - msg.time);
            if (drift > 0.55) doSeek(msg.time);
          }
        } finally {
          setTimeout(function() { window.__yaleRemoteSync = false; }, 500);
        }
      }

      function handleMessage(data) {
        try {
          var msg = JSON.parse(data);
          if (msg.type === 'SET_ROLE') {
            window.__yaleIsHost = !!msg.isHost;
            window.__yalePlaying = msg.playing !== false;
            if (msg.playing) setTimeout(autoStartPlayback, 300);
            return;
          }
          if (msg.type === 'AUTO_START') {
            window.__yaleAutoStarted = false;
            autoStartPlayback();
            setTimeout(autoStartPlayback, 600);
            setTimeout(autoStartPlayback, 1500);
            return;
          }
          if (msg.type === 'SYNC' || msg.type === 'SEEK_INITIAL') {
            remoteSync(msg);
            return;
          }
          if (msg.type === 'GET_TIME') {
            post({ type: 'TIME', time: getTime(), duration: getDuration() });
            return;
          }
          if (msg.type === 'PLAY') remoteSync({ playing: true, time: getTime() });
          if (msg.type === 'PAUSE') remoteSync({ playing: false, time: getTime() });
          if (msg.type === 'SEEK') remoteSync({ playing: window.__yalePlaying, time: msg.time });
        } catch(e) {}
      }

      window.addEventListener('message', function(e) { handleMessage(e.data); });
      document.addEventListener('message', function(e) { handleMessage(e.data); });

      setInterval(function() {
        var videos = document.querySelectorAll('video');
        videos.forEach(function(v) {
          attachVideo(v);
          if (!v.classList.contains('yale-isolated-video')) {
            v.classList.add('yale-isolated-video');
          }
          if (v.hasAttribute('controls')) {
            v.removeAttribute('controls');
          }
          v.controls = false;
        });
        runAdSkipper();
        hideBigPlayOverlays();
        if (window.__yalePlaying && !window.__yaleRemoteSync) {
          autoClickPlayAndResume();
          if (!window.__yaleAutoStarted) autoStartPlayback();
        }
        if (!window.__yaleRemoteSync) {
          post({ type: 'TIME', time: getTime(), duration: getDuration() });
        }
      }, 350);
    })();
    true;
  `;

  const videoIsolatorScript = `
    (function() {
      function log(msg) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'CONSOLE_LOG',
            message: '[Isolator] ' + msg
          }));
        } catch(e) {}
      }

      function isolateVideo() {
        if (!document) return;

        // Ocultar barras de scroll del body y html de forma segura
        try {
          if (document.documentElement) {
            document.documentElement.style.setProperty('overflow', 'hidden', 'important');
          }
          if (document.body) {
            document.body.style.setProperty('overflow', 'hidden', 'important');
            document.body.style.setProperty('margin', '0', 'important');
            document.body.style.setProperty('padding', '0', 'important');
            document.body.style.setProperty('background-color', 'black', 'important');
          }
        } catch(e) {}

        // --- CAPA DE ESCUDO AGRESIVO CSS PARA OCULTAR POPUPS ---
        try {
          const styleId = 'yale-aggressive-css-shield';
          if (document.head && !document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = \`
              .jw-dialog, .jw-modal, .jw-prompt, .jw-overlay, .jw-card,
              .vjs-modal-dialog, .vjs-modal,
              [class*="jw-dialog"], [class*="jw-modal"], [class*="jw-prompt"], [class*="jw-overlay"],
              [class*="resume-dialog"], [class*="resume-modal"], [class*="playback-resume"],
              .cue-resume-container, .resume-container, .resume-playback-prompt,
              .modal-overlay, .modal-container, .modal-backdrop,
              [class*="modal-dialog"], [class*="popup-container"], [class*="confirm-dialog"] {
                display: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
              }
            \`;
            document.head.appendChild(style);
          }
        } catch(e) {}

        // --- AUTOPLAY DIRECTO AGRESIVO PARA INVITADOS/SALA ---
        try {
          const videos = document.querySelectorAll('video');
          const shouldAutoplay = window.__yalePlaying !== undefined ? window.__yalePlaying : false;
          if (shouldAutoplay && videos.length > 0) {
            videos.forEach(v => {
              if (v.paused) {
                log("⚡ [Autoplay Guard] Detectado video pausado con sala en PLAYING. Forzando play...");
                v.play().catch(function(err) {
                  // Reintentar con mute en caso de bloqueo de autoplay
                  if (v.muted === false) {
                    v.muted = true;
                    v.play().then(function() {
                      setTimeout(function() { v.muted = false; }, 200);
                    }).catch(function() {});
                  }
                });
              }
            });
          }
        } catch(e) {}

        // --- DETECTOR, OCULTADOR Y AUTO-CLICKER AGRESIVO DE REANUDACIÓN (POPUP BUSTER ELITE) ---
        try {
          const resumeTextPatterns = [
            /continuar desde/i,
            /donde te quedaste/i,
            /resume playing/i,
            /welcome back/i,
            /reproducir desde/i,
            /desea continuar/i,
            /quedaste/i,
            /reanudar/i,
            /reproduciendo/i,
            /bienvenido de nuevo/i,
            /desea reanudar/i,
            /reproducción interrumpida/i,
            /reproducción pausada/i,
            /¿desea/i,
            /deseas/i,
            /quedo/i,
            /quedó/i,
            /desde el minuto/i,
            /desde el segundo/i,
            /desde la hora/i,
            /desde el inicio/i,
            /play from/i
          ];

          // Encontrar todos los elementos interactivos o de texto del DOM
          const targets = document.querySelectorAll('div, span, button, a, dialog, p, h1, h2, h3, h4, h5, h6, label');
          
          targets.forEach(el => {
            if (!el || !el.tagName) return;
            const tagName = el.tagName.toLowerCase();
            if (tagName === 'html' || tagName === 'body') return;
            if (el.children && el.children.length > 10) return; 
            
            const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
            if (!text || text.length > 100) return; // Evitar textos excesivamente largos
            
            const match = resumeTextPatterns.some(pattern => pattern.test(text));
            if (match) {
              // Encontramos un elemento con texto de reanudación. Busquemos su contenedor modal
              let modalContainer = null;
              let current = el;
              
              // Subir hasta 10 niveles para buscar el contenedor modal
              for (let i = 0; i < 10 && current; i++) {
                const curTagName = current.tagName.toLowerCase();
                if (curTagName === 'body' || curTagName === 'html') break;
                
                const style = window.getComputedStyle(current);
                const isModalPosition = style.position === 'absolute' || style.position === 'fixed';
                const zIndexVal = parseInt(style.zIndex);
                const hasHighZIndex = !isNaN(zIndexVal) && zIndexVal > 0;
                const className = (current.className || '').toString().toLowerCase();
                const idName = (current.id || '').toLowerCase();
                
                const isModalClass = className.includes('modal') || className.includes('dialog') || 
                                     className.includes('popup') || className.includes('overlay') || 
                                     className.includes('prompt') || className.includes('jw-') || 
                                     className.includes('vjs-') || className.includes('resume') ||
                                     className.includes('confirm') ||
                                     idName.includes('modal') || idName.includes('dialog') || 
                                     idName.includes('popup') || idName.includes('jw-') || 
                                     curTagName === 'dialog' || curTagName === 'jw-modal';
                                     
                if (isModalPosition || hasHighZIndex || isModalClass) {
                  modalContainer = current;
                  break;
                }
                current = current.parentElement;
              }
              
              if (!modalContainer && el.parentElement) {
                modalContainer = el.parentElement;
              }
              
              if (modalContainer && !modalContainer.yaleHidden) {
                modalContainer.yaleHidden = true;
                log("🚫 [Popup Buster Elite] ¡Modal de reanudación detectado y ocultado!: Tag: " + modalContainer.tagName + " Class: " + modalContainer.className);
                
                // Ocultar modal agresivamente
                modalContainer.style.setProperty('display', 'none', 'important');
                modalContainer.style.setProperty('opacity', '0', 'important');
                modalContainer.style.setProperty('pointer-events', 'none', 'important');
                modalContainer.style.setProperty('visibility', 'hidden', 'important');
                
                // Buscar y simular clicks en los botones de descarte o confirmación dentro de este modal
                const clickableTags = ['button', 'a', 'div', 'span'];
                let clickedAny = false;
                
                const children = modalContainer.querySelectorAll('*');
                children.forEach(btn => {
                  if (!btn || btn.yaleClicked) return;
                  const btnTagName = btn.tagName.toLowerCase();
                  if (!clickableTags.includes(btnTagName)) return;
                  
                  const btnText = (btn.innerText || btn.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                  if (!btnText || btnText.length > 40) return;
                  
                  const btnClass = (btn.className || '').toString().toLowerCase();
                  const btnId = (btn.id || '').toLowerCase();
                  const btnRole = (btn.getAttribute('role') || '').toLowerCase();
                  const btnStyle = window.getComputedStyle(btn);
                  
                  const isClickableElement = btnTagName === 'button' || btnTagName === 'a' || 
                                             btnRole === 'button' || btnClass.includes('button') || 
                                             btnClass.includes('btn') || btnClass.includes('jw-') || 
                                             btnClass.includes('vjs-') || btnStyle.cursor === 'pointer' ||
                                             btnText.length < 25; // Si es un texto corto en un modal, probablemente es un botón
                                             
                  if (isClickableElement && btnText) {
                    const clickPatterns = [
                      'continuar', 'reiniciar', 'iniciar', 'empezar', 'reproducir', 'sí', 'si', 'no', 'ok', 'yes', 'cancel', 'resume', 'start', 'play', 'gracias', 'thanks', 'reanudar', 'aceptar', 'entendido', 'reproducir de nuevo', 'desde el inicio'
                    ];
                    
                    const isTargetBtn = clickPatterns.some(pat => btnText === pat || btnText.includes(pat));
                    if (isTargetBtn) {
                      btn.yaleClicked = true;
                      log("🎯 [Popup Buster Elite] Cliqueando botón: '" + btnText + "' dentro del modal...");
                      
                      // Simular click de forma extremadamente robusta
                      try { btn.click(); } catch(e) {}
                      
                      try {
                        const rect = btn.getBoundingClientRect();
                        const clientX = rect.left + rect.width / 2;
                        const clientY = rect.top + rect.height / 2;
                        const screenX = window.screenX + clientX;
                        const screenY = window.screenY + clientY;
                        
                        const eventInit = {
                          bubbles: true,
                          cancelable: true,
                          view: window,
                          clientX: clientX,
                          clientY: clientY,
                          screenX: screenX,
                          screenY: screenY
                        };
                        
                        // Enviar MouseEvent por separado
                        try {
                          btn.dispatchEvent(new MouseEvent('mousedown', eventInit));
                          btn.dispatchEvent(new MouseEvent('mouseup', eventInit));
                          btn.dispatchEvent(new MouseEvent('click', eventInit));
                        } catch(meErr) {}
                        
                        // Enviar PointerEvent por separado
                        try {
                          if (window.PointerEvent) {
                            btn.dispatchEvent(new PointerEvent('pointerdown', eventInit));
                            btn.dispatchEvent(new PointerEvent('pointerup', eventInit));
                          }
                        } catch(peErr) {}
                        
                      } catch(e) {}
                      
                      clickedAny = true;
                    }
                  }
                });
                
                // Si no pudimos clickear ningún botón con texto, cliqueamos todos los botones directos del modal
                if (!clickedAny) {
                  const allButtons = modalContainer.querySelectorAll('button, [role="button"], .jw-button, .btn');
                  allButtons.forEach(btn => {
                    if (btn && !btn.yaleClicked) {
                      btn.yaleClicked = true;
                      log("🎯 [Popup Buster Elite] Cliqueando botón genérico: " + btn.tagName + " " + btn.className);
                      try { btn.click(); } catch(e) {}
                    }
                  });
                }
              }
            }
          });
        } catch(e) {
          log("Error en Popup Buster Elite: " + e.message);
        }

        // Buscar elementos de video directos
        const videos = document.querySelectorAll('video');
        if (videos.length > 0) {
          // --- DETECTOR Y AUTO-SALTADOR DE ANUNCIOS EN VIDEO (PRE-ROLL / VAST) ---
          try {
            const adTextPatterns = [/skip ad/i, /saltar anuncio/i, /this ad will end/i, /anuncio/i, /publicidad/i, /advertisement/i];
            let isAdActive = false;
            
            const allElements = document.querySelectorAll('div, span, button, a');
            let skipButton = null;

            allElements.forEach(el => {
              const text = el.innerText || el.textContent || '';
              if (text.trim()) {
                for (const pattern of adTextPatterns) {
                  if (pattern.test(text)) {
                    isAdActive = true;
                    if ((/skip/i.test(text) || /saltar/i.test(text)) && !/in \\d+/i.test(text) && !/en \\d+/i.test(text)) {
                      skipButton = el;
                    }
                    break;
                  }
                }
              }
            });

            if (isAdActive) {
              videos.forEach(v => {
                if (!v.paused && v.duration > 0) {
                  if (v.originalMutedState === undefined) {
                    v.originalMutedState = v.muted;
                  }
                  log("⚡ [Ad Skipper] Detectado anuncio de video. Acelerando (x16) y silenciando...");
                  v.playbackRate = 16.0; 
                  v.muted = true;
                }
              });
            } else {
              videos.forEach(v => {
                if (v.playbackRate > 2.0) {
                  v.playbackRate = 1.0;
                  if (v.originalMutedState !== undefined) {
                    v.muted = v.originalMutedState;
                    delete v.originalMutedState;
                  }
                  log("🎬 [Ad Skipper] Anuncio finalizado. Restaurando velocidad normal y volumen.");
                }
              });
            }

            if (skipButton) {
              log("🎯 [Ad Skipper] ¡Botón de saltar anuncio encontrado! Cliqueando...");
              skipButton.click();
              const rect = skipButton.getBoundingClientRect();
              const clickEvent = new MouseEvent('click', {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2
              });
              skipButton.dispatchEvent(clickEvent);
            }
          } catch (adError) {
            // Ignorado
          }
          
          // --- DETECTOR / FORZADOR DIRECTO DE APIS DE PLAYER ---
          try {
            if (window.jwplayer) {
              const jw = window.jwplayer();
              if (jw && typeof jw.getState === 'function') {
                const state = jw.getState();
                if (state === 'idle' || state === 'paused') {
                  log("⚡ [JWPlayer API Shield] Forzando reproducción mediante API de JWPlayer (estado actual: " + state + ")...");
                  jw.play();
                }
              }
            }
            if (window.videojs) {
              const players = window.videojs.players;
              for (const id in players) {
                const p = players[id];
                if (p && typeof p.play === 'function' && p.paused()) {
                   log("⚡ [VideoJS API Shield] Forzando reproducción mediante API de VideoJS...");
                   p.play();
                }
              }
            }
          } catch(e) {}

          videos.forEach(v => {
            const isHostUser = window.__yaleIsHost === true;
            if (isHostUser) {
              // Habilitar controles nativos si no los tiene
              if (!v.hasAttribute('controls')) {
                v.setAttribute('controls', 'true');
                v.controls = true;
                log("Controles nativos habilitados en elemento <video>.");
              }
            } else {
              // Deshabilitar controles nativos para invitados
              if (v.hasAttribute('controls')) {
                v.removeAttribute('controls');
                v.controls = false;
                log("Controles nativos deshabilitados en elemento <video> para invitado.");
              }
            }

            // Asegurar que el elemento de video ocupe el espacio completo de forma responsiva sin alterar su parentesco DOM
            v.style.setProperty('width', '100%', 'important');
            v.style.setProperty('height', '100%', 'important');
            v.style.setProperty('object-fit', 'contain', 'important');

            // Registrar listeners para capturar cambios de estado de reproducción y transmitirlos a la sala
            if (!v.hasSyncListeners) {
              v.hasSyncListeners = true;
              log("Registrando listeners de reproducción para sincronización en tiempo real...");
              
              v.addEventListener('playing', () => {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'PLAYING',
                  time: v.currentTime
                }));
              });

              v.addEventListener('pause', () => {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'PAUSED',
                  time: v.currentTime
                }));
              });

              v.addEventListener('timeupdate', () => {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'TIME',
                  time: v.currentTime
                }));
              });

              // Si el usuario toca el reproductor, mostrar controles de Yale
              v.addEventListener('click', () => {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'PLAYER_TAP'
                }));
              });
            }

            // Sincronización o Autoplay inicial
            const shouldAutoplay = window.__yalePlaying !== undefined ? window.__yalePlaying : false;
            // Usar el tiempo objetivo enviado via SEEK_INITIAL desde React Native
            const targetStartTime = window.__yaleTargetTime !== undefined ? window.__yaleTargetTime : 0;

            // Seek inicial: siempre aplicar si el tiempo objetivo es válido y no se ha seekado aún
            if (targetStartTime > 2 && !v.yaleInitialSeeked) {
              const diff = Math.abs(v.currentTime - targetStartTime);
              if (diff > 3) {
                v.yaleInitialSeeked = true;
                log('⏩ [Sync Inicial] Seeking al tiempo de la sala: ' + targetStartTime.toFixed(1) + 's (estaba en ' + v.currentTime.toFixed(1) + 's)');
                v.currentTime = targetStartTime;
              }
            }
            
            if (!v.hasAutoplayed && shouldAutoplay) {
              v.hasAutoplayed = true;
              log('⚡ [Autoplay] Iniciando reproducción automática inteligente...');
              
              // Intentar reproducir directamente
              v.play()
                .then(() => {
                  log('✅ [Autoplay] Reproducción automática iniciada con éxito.');
                })
                .catch(err => {
                  log('⚠️ [Autoplay] Falló reproducción directa: ' + err.message + '. Reintentando con MUTE...');
                  v.muted = true;
                  v.play()
                    .then(() => {
                      log('✅ [Autoplay] Reproducción iniciada silenciada. Des-silenciando en 250ms...');
                      setTimeout(() => {
                        v.muted = false;
                        log('🔊 [Autoplay] Des-silenciado completado.');
                      }, 250);
                    })
                    .catch(err2 => {
                      log('❌ [Autoplay] Falló reproducción automática incluso con MUTE: ' + err2.message);
                    });
                });
            }
          });
        }
      }

      // Escuchar comandos del Host de la sala para sincronizar reproducción
      function handleMessageFromApp(data) {
        try {
          const msg = JSON.parse(data);
          const video = document.querySelector('video');

          if (msg.type === 'SET_ROLE') {
            // Actualizar rol dinámicamente sin recargar el WebView
            window.__yaleIsHost = msg.isHost;
            window.__yalePlaying = msg.playing;
            log('🎭 [SET_ROLE] Rol actualizado: isHost=' + msg.isHost + ', playing=' + msg.playing);
            const vid = document.querySelector('video');
            if (vid) {
              if (msg.isHost) {
                if (!vid.hasAttribute('controls')) { vid.setAttribute('controls', 'true'); vid.controls = true; }
              } else {
                if (vid.hasAttribute('controls')) { vid.removeAttribute('controls'); vid.controls = false; }
              }
              if (msg.playing && vid.paused) {
                vid.play().catch(function() {
                  vid.muted = true;
                  vid.play().then(function() { setTimeout(function() { vid.muted = false; }, 300); }).catch(function() {});
                });
              }
            }
            return;
          }

          if (msg.type === 'SEEK_INITIAL') {
            // Seek inicial al cargar la sala — siempre se aplica, sin importar si el video está listo
            window.__yaleTargetTime = msg.time;
            log('⏩ [SEEK_INITIAL] Tiempo objetivo establecido: ' + msg.time + 's');
            if (video && msg.time > 2) {
              video.currentTime = msg.time;
              log('⏩ [SEEK_INITIAL] Seek aplicado directamente al video: ' + msg.time + 's');
              if (msg.autoplay) {
                video.play().catch(function() {
                  video.muted = true;
                  video.play().then(function() {
                    setTimeout(function() { video.muted = false; }, 300);
                  }).catch(function() {});
                });
              }
            }
            return;
          }

          if (!video) return;

          if (msg.type === 'PLAY') {
            log("Comando recibido: PLAY");
            video.play().catch(err => log("Error intentando reproducir: " + err.message));
          } else if (msg.type === 'PAUSE') {
            log("Comando recibido: PAUSE");
            video.pause();
          } else if (msg.type === 'SEEK') {
            if (Math.abs(video.currentTime - msg.time) > 2.5) {
              log("Comando recibido: SEEK a " + msg.time);
              video.currentTime = msg.time;
            }
          }
        } catch(e) {}
      }

      window.addEventListener('message', (e) => handleMessageFromApp(e.data));
      document.addEventListener('message', (e) => handleMessageFromApp(e.data));

      setInterval(isolateVideo, 1000);
      isolateVideo();
    })();
    true;
  `;

  const processingVideoIdRef = useRef(null);

  const handleYtMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'YOUTUBE_VIDEO_DETECTED') {
        const videoId = data.id;
        // Guard: ignorar si ya estamos procesando este mismo video
        if (processingVideoIdRef.current === videoId) return;
        processingVideoIdRef.current = videoId;

        const thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        // Use server-side Innertube to get real title
        fetch(`${API_BASE_URL}/api/youtube/info/${videoId}`)
          .then(r => r.json())
          .then(info => {
            const titulo = (info && info.titulo && info.titulo.trim()) ? info.titulo.trim() : `Video ${videoId}`;
            setShowYtBrowser(false);
            handleSelectVideo({ id: videoId, titulo, miniatura: info.miniatura || thumbnail });
          })
          .catch(() => {
            setShowYtBrowser(false);
            handleSelectVideo({ id: videoId, titulo: `Video ${videoId}`, miniatura: thumbnail });
          })
          .finally(() => {
            // Resetear tras 3s para permitir re-seleccionar el mismo video si se vuelve a buscar
            setTimeout(() => { processingVideoIdRef.current = null; }, 3000);
          });
      }
    } catch (e) {
      console.warn("Error parseando selección de YouTube:", e);
    }
  };

  const webViewRef = useRef(null);
  const localCurrentTime = useRef(0);
  const chatInputRef = useRef(null);
  const joinTime = useRef(Date.now());
  const isLeavingRef = useRef(false);
  const prevCreatorRef = useRef(null);
  const streamLoadedForIdRef = useRef(null);
  const roomDataRef = useRef(null);
  const lastGuestPlaySyncRef = useRef(null);

  useEffect(() => {
    roomDataRef.current = roomData;
  }, [roomData]);

  const playerRef = useRef({
    getCurrentTime: () => {
      return Promise.resolve(localCurrentTime.current);
    },
    seekTo: (time, allowSeekAhead) => {
      webViewRef.current?.postMessage(JSON.stringify({ type: 'SEEK', time }));
    }
  });

  const postSyncToWebView = (videoActual, shouldPlay) => {
    if (!webViewRef.current || !videoActual) return;
    webViewRef.current.postMessage(JSON.stringify({
      type: 'SYNC',
      time: getCalculatedVideoTime(videoActual),
      playing: shouldPlay
    }));
  };

  const syncWebViewPlayback = (videoActual, hostFlag, shouldPlay) => {
    if (!webViewRef.current || !videoActual) return;
    webViewRef.current.postMessage(JSON.stringify({
      type: 'SET_ROLE',
      isHost: hostFlag,
      playing: shouldPlay
    }));
    postSyncToWebView(videoActual, shouldPlay);
  };

  const postBrowserAutoStart = () => {
    webViewRef.current?.postMessage(JSON.stringify({ type: 'AUTO_START' }));
  };

  const toggleFullscreen = async () => {
    bumpPlayerControls();
    const next = !isFullscreen;
    setIsFullscreen(next);
    try {
      if (next) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        RNStatusBar.setHidden(true, 'fade');
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        RNStatusBar.setHidden(false, 'fade');
      }
    } catch (e) {
      console.warn('No se pudo cambiar orientación:', e);
    }
  };

  const handleSeek = (time) => {
    if (!isHost || !roomData?.video_actual?.id) return;
    bumpPlayerControls();
    const clamped = Math.max(0, Math.min(time, videoDuration || time));
    localCurrentTime.current = clamped;
    setDisplayTime(clamped);
    isInternalChange.current = true;
    webViewRef.current?.postMessage(JSON.stringify({ type: 'SEEK', time: clamped }));
    socket.emit('video-seek', { roomId, currentTime: clamped });
    socket.emit('video-state-change', {
      roomId,
      state: playing ? 'PLAYING' : 'PAUSED',
      currentTime: clamped
    });
    setTimeout(() => { isInternalChange.current = false; }, 400);
  };

  const applyGuestSync = useCallback(() => {
    const data = roomDataRef.current;
    if (!playerReady || !data?.video_actual || isInternalChange.current || isLeavingRef.current) return;
    if (user?.username === data.creador) return;

    const shouldPlay = data.video_actual.state === 'PLAYING';
    const serverTime = getCalculatedVideoTime(data.video_actual);
    const drift = Math.abs(localCurrentTime.current - serverTime);

    if (!webViewRef.current) return;

    if (drift > GUEST_SYNC_DRIFT_THRESHOLD) {
      isInternalChange.current = true;
      localCurrentTime.current = serverTime;
      webViewRef.current.postMessage(JSON.stringify({
        type: 'SYNC',
        time: serverTime,
        playing: shouldPlay
      }));
      setTimeout(() => { isInternalChange.current = false; }, 400);
      lastGuestPlaySyncRef.current = shouldPlay;
    } else if (lastGuestPlaySyncRef.current !== shouldPlay) {
      isInternalChange.current = true;
      webViewRef.current.postMessage(JSON.stringify({
        type: 'SYNC',
        time: serverTime,
        playing: shouldPlay
      }));
      setTimeout(() => { isInternalChange.current = false; }, 300);
      lastGuestPlaySyncRef.current = shouldPlay;
    }
  }, [playerReady, user?.username]);

  const handlePlayerMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'CONSOLE_LOG') {
        console.log("📱 [Room WebView Console]:", msg.message);
      } else if (msg.type === 'PLAYING') {
        onPlayerStateChange('playing');
      } else if (msg.type === 'PAUSED') {
        onPlayerStateChange('paused');
      } else if (msg.type === 'ENDED') {
        onPlayerStateChange('ended');
      } else if (msg.type === 'TIME') {
        const t = typeof msg.time === 'number' ? msg.time : 0;
        localCurrentTime.current = t;
        const isBrowser = roomDataRef.current?.video_actual?.id === 'browser_sync';
        if (isHostRef.current || isBrowser) {
          setDisplayTime(t);
        }
        if (msg.duration && Number.isFinite(msg.duration) && msg.duration > 0) {
          setVideoDuration(msg.duration);
        }
      } else if (msg.type === 'DURATION') {
        if (msg.duration && Number.isFinite(msg.duration)) {
          setVideoDuration(msg.duration);
        }
      } else if (msg.type === 'ERROR') {
        console.warn("🚨 [WebView HTML Video Element Error Code]:", msg.code);
      } else if (msg.type === 'PLAYER_TAP') {
        bumpPlayerControls();
      }
    } catch (e) {
      console.warn("Error parsing HTML video event:", e);
    }
  };

  // Sincronizar play/pause hacia el WebView (YouTube stream; en sitios web usa reproductor nativo)
  useEffect(() => {
    if (!playerReady || !webViewRef.current || isInternalChange.current) return;
    if (roomDataRef.current?.video_actual?.id === 'browser_sync') return;
    webViewRef.current.postMessage(JSON.stringify({ type: playing ? 'PLAY' : 'PAUSE' }));
  }, [playing, playerReady]);

  // Vigilante: invitados siguen el tiempo de la sala en tiempo real
  useEffect(() => {
    if (!playerReady) return;
    applyGuestSync();
    const intervalMs = roomDataRef.current?.video_actual?.id === 'browser_sync'
      ? 400
      : GUEST_SYNC_INTERVAL_MS;
    const syncInterval = setInterval(applyGuestSync, intervalMs);
    return () => clearInterval(syncInterval);
  }, [playerReady, applyGuestSync, roomData?.video_actual?.id]);

  // Host envía posición periódica para que todos mantengan el mismo audio/video
  useEffect(() => {
    if (!isHost || !playerReady || !roomId) return;
    const heartbeatMs = roomDataRef.current?.video_actual?.id === 'browser_sync' ? 800 : HOST_HEARTBEAT_MS;
    const heartbeat = setInterval(() => {
      if (isInternalChange.current || isLeavingRef.current) return;
      socket.emit('video-state-change', {
        roomId,
        state: playing ? 'PLAYING' : 'PAUSED',
        currentTime: localCurrentTime.current
      });
    }, heartbeatMs);
    return () => clearInterval(heartbeat);
  }, [isHost, playerReady, playing, roomId]);

  // Re-sincronizar al unirse o cargar stream
  useEffect(() => {
    if (!playerReady || !roomData?.video_actual?.id) return;
    const shouldPlay = roomData.video_actual.state === 'PLAYING';
    if (roomData.video_actual.id === 'browser_sync') {
      syncWebViewPlayback(roomData.video_actual, isHost, shouldPlay);
      const timers = [0, 400, 900, 1800, 3500].map((ms) =>
        setTimeout(() => {
          syncWebViewPlayback(roomData.video_actual, isHost, shouldPlay);
          postBrowserAutoStart();
        }, ms)
      );
      return () => timers.forEach(clearTimeout);
    }
    const delays = [0, 350, 900, 2000, 4000];
    const timers = delays.map((ms) =>
      setTimeout(() => syncWebViewPlayback(roomData.video_actual, isHost, shouldPlay), ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [playerReady, roomData?.video_actual?.id]);

  // Avanzar barra y reloj en la UI (host + invitados)
  useEffect(() => {
    if (!playerReady || !roomData?.video_actual) return;
    const tick = setInterval(() => {
      const data = roomDataRef.current;
      if (!data?.video_actual) return;
      const isHostUser = user?.username === data.creador;
      let t;
      if (data.video_actual.id === 'browser_sync') {
        t = localCurrentTime.current;
        webViewRef.current?.postMessage(JSON.stringify({ type: 'GET_TIME' }));
      } else if (isHostUser) {
        t = localCurrentTime.current;
        if (playing) {
          webViewRef.current?.postMessage(JSON.stringify({ type: 'GET_TIME' }));
        }
      } else {
        t = data.video_actual.state === 'PLAYING'
          ? getCalculatedVideoTime(data.video_actual)
          : (data.video_actual.currentTime || localCurrentTime.current);
        localCurrentTime.current = t;
      }
      if (Math.abs(t - lastUiTimeRef.current) >= 0.12) {
        lastUiTimeRef.current = t;
        setDisplayTime(t);
      }
    }, UI_TICK_MS);
    return () => clearInterval(tick);
  }, [playerReady, roomData?.video_actual?.id, user?.username]);

  // YouTube: mostrar controles al cargar. Navegador: ocultos hasta tocar el video.
  useEffect(() => {
    if (!playerReady || !roomData?.video_actual?.id) return;
    if (roomData.video_actual.id === 'browser_sync') {
      setShowPlayerControls(false);
      controlsOpacity.setValue(0);
      return;
    }
    bumpPlayerControls();
  }, [playerReady, roomData?.video_actual?.id, bumpPlayerControls, controlsOpacity]);

  // Restaurar orientación al salir de la sala o desmontar
  useEffect(() => {
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      RNStatusBar.setHidden(false, 'fade');
    };
  }, []);

  // Cuando cambia el admin, mantener el video en marcha (no recargar WebView)
  useEffect(() => {
    if (!roomData?.creador || !playerReady) return;
    const videoId = roomData.video_actual?.id;
    if (!videoId || videoId === 'browser_sync') {
      prevCreatorRef.current = roomData.creador;
      return;
    }

    if (prevCreatorRef.current && prevCreatorRef.current !== roomData.creador) {
      const shouldPlay = roomData.video_actual?.state === 'PLAYING';
      setPlaying(shouldPlay);
      syncWebViewPlayback(roomData.video_actual, isHost, shouldPlay);
    }

    prevCreatorRef.current = roomData.creador;
  }, [roomData?.creador, playerReady, isHost]);

  // Mensaje en el chat de Estás viendo
  useEffect(() => {
    if (roomData?.video_actual?.titulo) {
      const currentTitle = roomData.video_actual.titulo;
      if (currentTitle !== lastSeenTitleRef.current) {
        lastSeenTitleRef.current = currentTitle;
        setMessages((prev) => [
          ...prev, 
          { 
            id: `sys-${Date.now()}-${Math.random()}`, 
            text: currentTitle, 
            isSystem: true, 
            isNowPlaying: true 
          }
        ]);
      }
    }
  }, [roomData?.video_actual?.titulo]);

  // Actualizar controles de host en el WebView
  useEffect(() => {
    if (!playerReady || !webViewRef.current) return;
    webViewRef.current.postMessage(JSON.stringify({ type: 'SET_ROLE', isHost, playing }));
  }, [isHost, playerReady]);

  // Cuando cambie el video actual, marcar que el reproductor está listo y cargar el stream
  useEffect(() => {
    if (roomData?.video_actual?.id) {
      const videoId = roomData.video_actual.id;

      // Ya cargado: no volver a pedir el stream (evita pantalla negra al cambiar de admin)
      if (videoId !== 'browser_sync' && streamLoadedForIdRef.current === videoId) {
        return;
      }

      setVideoDuration(0);
      setDisplayTime(0);
      
      if (videoId === 'browser_sync') {
        setPlayerReady(true);
        const shouldPlay = roomData.video_actual?.state === 'PLAYING';
        syncWebViewPlayback(roomData.video_actual, isHost, shouldPlay);
        [0, 500, 1200, 2500].forEach((ms) => setTimeout(postBrowserAutoStart, ms));
        return;
      }
      
      const fetchStream = async () => {
        try {
          const streamUrl = `${API_BASE_URL}/api/youtube/stream?videoId=${videoId}`;
          console.log("🎉 Loading server proxy stream:", streamUrl);

          const startTime = getCalculatedVideoTime(roomData.video_actual);
          console.log(`⏱️ Starting mobile player at calculated seek time: ${startTime}s`);

          webViewRef.current?.postMessage(JSON.stringify({ 
            type: 'LOAD', 
            url: streamUrl,
            autoplay: playing,
            startTime: startTime
          }));
          streamLoadedForIdRef.current = videoId;
          setPlayerReady(true);
          syncWebViewPlayback(roomData.video_actual, isHost, playing);
        } catch (err) {
          console.error("Error loading video stream in Room.js:", err.message);
        }
      };
      
      fetchStream();
    }
  }, [roomData?.video_actual?.id]);

  const isInternalChange = useRef(false);
  const chatListRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Autoscroll al final al recibir o enviar mensajes con un pequeño delay para asegurar el render
  useEffect(() => {
    if (messages.length > 0) {
      const timer = setTimeout(() => {
        chatListRef.current?.scrollToEnd({ animated: true });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [messages.length]);

  // 1. Gestión de conexión y eventos por WebSockets
  useEffect(() => {
    if (!roomId || !user) return;

    socket.emit('join-room', { roomId, user });

    const handleRoomState = (data) => {
      setRoomData(data);
      setParticipants(data.participantes || []);
      setQueue(data.queue || []);
      // Solo ocultar sugerencias si hay un video PLAYING activo.
      // Si llega PAUSED (video terminó, cola vacía), no interferir con las sugerencias.
      if (data.video_actual?.state === 'PLAYING') {
        setShowSuggestions(false);
      }
      if (data.video_actual?.state) {
        setPlaying(data.video_actual.state === 'PLAYING');
      }
    };

    const handleNewParticipant = (list) => setParticipants(list || []);
    const handleMessage = (msg) => {
      setMessages((prev) => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };
    
    const handleVideoUpdate = ({ state, currentTime }) => {
      setRoomData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          video_actual: {
            ...prev.video_actual,
            state: state,
            currentTime: currentTime,
            lastUpdate: Date.now()
          }
        };
      });

      if (!isInternalChange.current) {
        isInternalChange.current = true;

        if (webViewRef.current) {
          webViewRef.current.postMessage(JSON.stringify({
            type: 'SYNC',
            time: currentTime,
            playing: state === 'PLAYING'
          }));
        } else if (playerRef.current) {
          playerRef.current.getCurrentTime().then(localTime => {
            if (Math.abs(localTime - currentTime) > 2) {
              playerRef.current.seekTo(currentTime, true);
            }
          }).catch(() => {});
        }

        setPlaying(state === 'PLAYING');
        setTimeout(() => { isInternalChange.current = false; }, 800);
      }
    };

    socket.on('room-state', handleRoomState);
    socket.on('nuevo-participante', handleNewParticipant);
    socket.on('participante-salio', handleNewParticipant);
    socket.on('video-state-update', handleVideoUpdate);

    const handleSeekUpdate = (currentTime) => {
      setRoomData((prev) => {
        if (!prev?.video_actual) return prev;
        const shouldPlay = prev.video_actual.state === 'PLAYING';
        if (
          !isInternalChange.current &&
          webViewRef.current &&
          user?.username !== prev.creador
        ) {
          isInternalChange.current = true;
          webViewRef.current.postMessage(JSON.stringify({
            type: 'SYNC',
            time: currentTime,
            playing: shouldPlay
          }));
          setTimeout(() => { isInternalChange.current = false; }, 350);
        }
        return {
          ...prev,
          video_actual: {
            ...prev.video_actual,
            currentTime,
            lastUpdate: Date.now()
          }
        };
      });
    };

    socket.on('video-seek-update', handleSeekUpdate);
    socket.on('receive-message', handleMessage);
    
    socket.on('receive-message-reaction', ({ messageId, emoji }) => {
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: [...(m.reactions || []), emoji] } : m));
    });

    const handleTyping = (username) => {
      if (username !== user?.username) {
        setTypingUsers(prev => prev.includes(username) ? prev : [...prev, username]);
      }
    };
    const handleStopTyping = (username) => {
      setTypingUsers(prev => prev.filter(u => u !== username));
    };

    socket.on('user-typing', handleTyping);
    socket.on('user-stop-typing', handleStopTyping);

    // Cola de reproducción
    const handleQueueUpdated = (newQueue) => {
      setQueue(newQueue || []);
    };
    const handleQueueEmpty = () => {
      setShowSuggestions(true);
      const title = roomDataRef.current?.video_actual?.titulo || 'music';
      fetch(`${API_BASE_URL}/api/youtube/recommendations?q=${encodeURIComponent(title)}`)
        .then(res => res.json())
        .then(data => setSuggestions(data))
        .catch(() => {});
    };
    socket.on('queue-updated', handleQueueUpdated);
    socket.on('queue-empty', handleQueueEmpty);

    return () => {
      isLeavingRef.current = true;
      socket.emit('leave-room');
      socket.off('room-state');
      socket.off('nuevo-participante');
      socket.off('participante-salio');
      socket.off('video-state-update');
      socket.off('video-seek-update');
      socket.off('receive-message');
      socket.off('receive-message-reaction');
      socket.off('user-typing', handleTyping);
      socket.off('user-stop-typing', handleStopTyping);
      socket.off('queue-updated', handleQueueUpdated);
      socket.off('queue-empty', handleQueueEmpty);
    };
  }, [roomId]);

  // 3. Capturar estado del reproductor móvil
  const onPlayerStateChange = (state) => {
    if (state === 'ended') {
      // Emitir al servidor para que avance la cola automáticamente
      if (isHostRef.current) {
        socket.emit('video-ended', { roomId });
      }
      // Actualizar roomData local INMEDIATAMENTE a PAUSED.
      // El host emite video-state-change pero no recibe video-state-update de vuelta
      // (solo lo reciben los otros clientes), así que debemos actualizar nuestro
      // propio estado para que handleSelectVideo no crea que sigue PLAYING.
      setRoomData(prev => {
        if (!prev?.video_actual) return prev;
        return { ...prev, video_actual: { ...prev.video_actual, state: 'PAUSED' } };
      });
      // Las sugerencias se mostrarán solo si el servidor emite 'queue-empty'
    }

    if (isLeavingRef.current || isInternalChange.current || !roomData) return;

    const isHostUser = user?.username === roomData?.creador;
    const inBrowserMode = roomData.video_actual?.id === 'browser_sync';

    // Ignorar actualizaciones espurias durante la carga inicial (solo stream YouTube)
    if (!inBrowserMode && Date.now() - joinTime.current < 2500) {
      return;
    }

    if (!isHostUser) {
      setPlaying(roomData?.video_actual?.state === 'PLAYING');
      return;
    }

    const mappedState = state === 'playing' ? 'PLAYING' : (state === 'paused' || state === 'ended') ? 'PAUSED' : null;
    if (mappedState) {
      const currentTime = localCurrentTime.current;
      setPlaying(mappedState === 'PLAYING');
      socket.emit('video-state-change', {
        roomId,
        state: mappedState,
        currentTime
      });
    }
  };

  const handleManualSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/youtube/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();
      setSuggestions(data);
    } catch (error) {
      console.error("Error buscando en la sala móvil:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSendMessage = () => {
    if (!newMessage.trim()) return;

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    socket.emit('stop-typing', { roomId, username: user?.username });

    const msg = {
      id: Date.now() + Math.random().toString(),
      username: user.username,
      avatarUrl: user.avatarUrl,
      text: newMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      reactions: []
    };
    socket.emit('send-message', { roomId, message: msg });
    setMessages((prev) => [...prev, msg]);
    setNewMessage('');
    setShowEmojiPicker(false);
    
    // Mantener enfocado el input para que no se cierre el teclado en móviles
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 50);
  };

  const handleEmojiSelect = (emoji) => {
    setNewMessage((prev) => prev + emoji);
  };

  const handleAddMessageReaction = (messageId, emoji) => {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: [...(m.reactions || []), emoji] } : m));
    socket.emit('message-reaction', { roomId, messageId, emoji });
    setActiveReactionMenuId(null);
  };



  const handleSelectVideo = (video) => {
    setShowSuggestions(false);
    // Solo añadir a cola si hay un video PLAYING activamente.
    // Si terminó (PAUSED/ENDED) o no hay video → reproducir directo.
    const isCurrentlyPlaying =
      roomData?.video_actual?.id &&
      roomData.video_actual.id !== '' &&
      roomData.video_actual.state === 'PLAYING';

    if (isCurrentlyPlaying) {
      // Hay algo reproduciéndose → va a la cola
      socket.emit('add-to-queue', { roomId, video, username: user?.username });
    } else {
      // Nada reproduciéndose (terminó, pausado o sala vacía) → reproducir ahora
      socket.emit('change-video', { roomId, video });
    }
  };

  const togglePlay = () => {
    if (!isHost) return;
    bumpPlayerControls();
    const nextPlaying = !playing;
    setPlaying(nextPlaying);
    const currentTime = localCurrentTime.current;
    socket.emit('video-state-change', {
      roomId,
      state: nextPlaying ? 'PLAYING' : 'PAUSED',
      currentTime
    });
    webViewRef.current?.postMessage(JSON.stringify({
      type: 'SYNC',
      time: currentTime,
      playing: nextPlaying
    }));
  };

  const confirmExit = () => {
    const isHost = user?.username === roomData?.creador;
    Alert.alert(
      "¿Salir de la sala?",
      isHost ? "Si sales, el siguiente participante será el nuevo líder de la sala." : "Volverás al lobby principal.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Sí, salir", style: "destructive", onPress: () => {
          isLeavingRef.current = true;
          onLeave();
        }}
      ]
    );
  };

  // Interceptar botón de retroceso físico de Android
  useEffect(() => {
    if (showMiniBrowser || showYtBrowser) {
      return;
    }

    const backAction = () => {
      if (isFullscreen) {
        toggleFullscreen();
        return true;
      }
      confirmExit();
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      backAction
    );

    return () => backHandler.remove();
  }, [roomData, showMiniBrowser, showYtBrowser, isFullscreen]);

  if (!roomData) {
    return (
      <View className="flex-grow bg-dark-900 items-center justify-center">
        <ActivityIndicator size="large" color="#6366f1" className="mb-4" />
        <Text className="text-gray-400 font-bold uppercase tracking-widest text-xs animate-pulse">
          Conectando a Yale...
        </Text>
      </View>
    );
  }

  const renderPlayerWebView = () => {
    if (!roomData?.video_actual?.id) {
      return (
        <View className="absolute inset-0 items-center justify-center bg-dark-900/90 z-20 p-6">
          <Text className="text-gray-500 text-[10px] font-black uppercase tracking-widest text-center">
            Selecciona una canción para iniciar la reproducción
          </Text>
        </View>
      );
    }

    if (roomData.video_actual.id === 'browser_sync') {
      return (
        <WebView
          ref={webViewRef}
          source={{ uri: roomData.video_actual.browserUrl }}
          injectedJavaScript={browserNativeSyncScript}
          injectedJavaScriptForMainFrameOnly={false}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
          onMessage={handlePlayerMessage}
          domStorageEnabled={true}
          javaScriptEnabled={true}
          mixedContentMode="always"
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          incognito={true}
          cacheEnabled={false}
          cacheMode="LOAD_NO_CACHE"
          style={{ width: '100%', height: '100%', backgroundColor: 'black' }}
          onShouldStartLoadWithRequest={(request) => {
            const url = request.url;
            if (url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) return true;
            if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
            return true;
          }}
        />
      );
    }

    return (
      <WebView
        ref={webViewRef}
        source={HTML_PLAYER_SOURCE}
        onMessage={handlePlayerMessage}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        domStorageEnabled={true}
        javaScriptEnabled={true}
        mixedContentMode="always"
        style={{ width: '100%', height: '100%', backgroundColor: 'black' }}
      />
    );
  };

  const renderPlayerControls = () => {
    if (!roomData?.video_actual?.id || !showPlayerControls) return null;

    const guestLocked = !isHost;

    const progressWidth = progressAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', '100%'],
    });

    return (
      <Animated.View
        onStartShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 60,
          opacity: controlsOpacity,
          backgroundColor: 'rgba(0,0,0,0.82)',
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: isFullscreen ? 14 : 8,
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.08)',
        }}
      >
        {guestLocked && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 4 }}>
            <Lock size={10} color="#fbbf24" />
            <Text style={{ color: '#fbbf24', fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>
              SINCRONIZADO
            </Text>
          </View>
        )}

        <TouchableOpacity
          activeOpacity={guestLocked ? 1 : 0.8}
          disabled={guestLocked}
          onPress={(e) => {
            if (guestLocked || !progressBarWidthRef.current) return;
            bumpPlayerControls();
            const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / progressBarWidthRef.current));
            handleSeek(ratio * (videoDuration || 0));
          }}
          onLayout={(e) => { progressBarWidthRef.current = e.nativeEvent.layout.width; }}
          style={{
            height: 5,
            backgroundColor: 'rgba(255,255,255,0.2)',
            borderRadius: 3,
            marginBottom: 8,
            overflow: 'hidden',
            opacity: guestLocked ? 0.55 : 1,
          }}
        >
          <Animated.View style={{ width: progressWidth, height: '100%', backgroundColor: guestLocked ? '#6b7280' : '#6366f1' }} />
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: guestLocked ? 0.45 : 1 }}>
            <TouchableOpacity
              onPress={() => { bumpPlayerControls(); togglePlay(); }}
              disabled={guestLocked}
              style={{ padding: 4 }}
            >
              {playing ? (
                <Pause size={24} color="#fff" fill="#fff" />
              ) : (
                <Play size={24} color="#fff" fill="#fff" />
              )}
            </TouchableOpacity>
            <Text style={{ color: '#d4d4d4', fontSize: 11, fontWeight: '600', minWidth: 88 }}>
              {formatPlayerTime(displayTime)} / {formatPlayerTime(videoDuration)}
            </Text>
          </View>

          <TouchableOpacity onPress={() => { bumpPlayerControls(); toggleFullscreen(); }} style={{ padding: 6 }}>
            {isFullscreen ? (
              <Minimize2 size={22} color="#fff" strokeWidth={2} />
            ) : (
              <Maximize2 size={22} color="#fff" strokeWidth={2} />
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-dark-900" edges={isFullscreen ? [] : undefined}>
      <StatusBar hidden={isFullscreen} style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        keyboardVerticalOffset={0}
        style={{ flex: 1 }}
      >
      <Pressable
        style={{ flex: 1 }}
        pointerEvents="box-none"
        onPress={hidePlayerControls}
      >
      
      {!isFullscreen && (
      <View style={{ backgroundColor: '#111111', paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', zIndex: 50 }}>
        {/* Izquierda: X salir + Configuración */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TouchableOpacity onPress={confirmExit} style={{ padding: 4 }}>
            <X size={22} color="#ffffff" strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity style={{ padding: 4 }} onPress={() => {}}>
            <Settings size={20} color="#aaaaaa" strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {/* Centro: Logo Yale */}
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: '#ffffff', fontSize: 22, fontWeight: '900', letterSpacing: 6, textTransform: 'uppercase' }}>yale</Text>
        </View>

        {/* Derecha: Lupa + Participantes */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TouchableOpacity style={{ padding: 4 }} onPress={() => setShowSourceMenu(true)}>
            <Search size={20} color="#aaaaaa" strokeWidth={2} />
          </TouchableOpacity>
          <TouchableOpacity style={{ padding: 4 }} onPress={() => setShowParticipants(true)}>
            <View style={{ position: 'relative' }}>
              <Users size={22} color="#aaaaaa" strokeWidth={2} />
              {participants.length > 0 && (
                <View style={{ position: 'absolute', top: -4, right: -6, backgroundColor: '#6366f1', borderRadius: 8, minWidth: 14, height: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }}>
                  <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900' }}>{participants.length}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>

      </View>
      )}

      {/* REPRODUCTOR */}
      <View
        style={
          isFullscreen
            ? { flex: 1, backgroundColor: '#000' }
            : { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }
        }
        className={isFullscreen ? '' : 'border-b border-white/5'}
      >
        <View style={{ flex: 1, position: 'relative' }}>
          <View
            style={{ flex: 1 }}
            pointerEvents={
              roomData.video_actual?.id === 'browser_sync' && isHost ? 'auto' : 'none'
            }
          >
            {renderPlayerWebView()}
          </View>
          {!showPlayerControls && (
            <TouchableOpacity
              activeOpacity={1}
              onPress={bumpPlayerControls}
              style={[StyleSheet.absoluteFillObject, { zIndex: 30 }]}
            />
          )}
          {renderPlayerControls()}
        </View>
      </View>

      {!isFullscreen && (
      <View className="flex-1 bg-dark-800">

        {/* Mensajes del Chat */}
        <FlatList
          ref={chatListRef}
          data={messages}
          keyExtractor={(item, index) => item.id || index.toString()}
          onContentSizeChange={() => chatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => chatListRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: 8 }}
          renderItem={({ item }) => {
            if (item.isSystem) {
              if (item.isNowPlaying) {
                return (
                  <View style={{ alignItems: 'flex-start', marginVertical: 10, paddingHorizontal: 16 }}>
                    <View style={{ backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, maxWidth: '85%', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
                        <Play size={12} color="#ffffff" fill="#ffffff" />
                        <Text style={{ color: '#ffffff', fontWeight: '900', fontSize: 11, marginLeft: 6, letterSpacing: 0.3 }}>
                          Estás viendo
                        </Text>
                      </View>
                      <Text style={{ color: '#818cf8', fontWeight: '700', fontSize: 12, lineHeight: 18, flexWrap: 'wrap' }}>
                        {item.text}
                      </Text>
                    </View>
                  </View>
                );

              }
              return (
                <View className="items-center my-2">
                  <Text className="bg-dark-900 border border-white/5 text-gray-500 text-[9px] px-3.5 py-1 rounded-full font-black uppercase tracking-wider">
                    {item.text}
                  </Text>
                </View>
              );
            }

            const isMe = item.username === user.username;
            return (
              <View className={`flex-row px-4 py-3.5 gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                <Image source={{ uri: item.avatarUrl }} className="w-7 h-7 rounded-full border border-white/10 mt-1" />
                <View className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && <Text className="text-xs font-black text-indigo-400 mb-0.5">{item.username}</Text>}
                  
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => setActiveReactionMenuId(activeReactionMenuId === item.id ? null : item.id)}
                    className={`p-2.5 rounded-2xl mt-1 border border-white/5 ${isMe ? 'bg-indigo-600 rounded-tr-none' : 'bg-dark-900/50 rounded-tl-none'}`}
                  >
                    <Text className="text-white text-base">{item.text}</Text>
                  </TouchableOpacity>

                  {/* Menú de Reacción de mensaje */}
                  {activeReactionMenuId === item.id && (
                    <View className="flex-row bg-dark-900 border border-white/10 p-1 rounded-full shadow-2xl mt-1 gap-2">
                      {['❤️', '😂', '🔥', '👍'].map(emoji => (
                        <TouchableOpacity 
                          key={emoji} 
                          onPress={() => handleAddMessageReaction(item.id, emoji)}
                          className="px-1"
                        >
                          <Text className="text-sm">{emoji}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {/* Reacciones sobre el mensaje */}
                  {item.reactions && item.reactions.length > 0 && (
                    <View className="flex-row flex-wrap gap-1 mt-1">
                      {Array.from(new Set(item.reactions)).map((emoji, idx) => (
                        <View key={idx} className="bg-dark-900/80 border border-white/5 px-1.5 py-0.5 rounded-full flex-row items-center gap-0.5">
                          <Text className="text-[9px]">{emoji}</Text>
                          <Text className="text-[8px] font-bold text-gray-400">
                            {item.reactions.filter(e => e === emoji).length}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View className="items-center justify-center py-20 opacity-20">
              <MessageSquare className="w-10 h-10 text-gray-400 mb-2" />
              <Text className="text-xs font-black uppercase tracking-widest text-center">Chat en Vivo</Text>
            </View>
          }
        />

        {/* Indicador de Escritura */}
        {typingUsers.length > 0 && (
          <View className="flex-row items-center px-4 py-1.5 bg-dark-800">
            <Text className="text-[9px] text-gray-500 italic font-semibold">
              {typingUsers.join(', ')} está escribiendo...
            </Text>
          </View>
        )}

        {/* Floating Emoji Picker Tray */}
        {showEmojiPicker && (
          <View className="flex-row justify-around bg-dark-900 border-t border-white/5 py-3 px-2">
            {['❤️', '😂', '🔥', '👍', '😮', '🎉', '👏', '😍'].map(emoji => (
              <TouchableOpacity 
                key={emoji} 
                onPress={() => handleEmojiSelect(emoji)}
                className="px-2"
              >
                <Text className="text-xl">{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Input del Chat (Estilo Rave Premium) */}
        <View className="flex-row px-4 py-3 bg-[#1e1e1e]/90 border-t border-white/10 items-center">
          <TouchableOpacity 
            onPress={() => setShowEmojiPicker(!showEmojiPicker)}
            className="mr-2.5 p-1"
          >
            <Smile className={`w-6 h-6 ${showEmojiPicker ? 'text-indigo-400' : 'text-white'}`} color={showEmojiPicker ? '#818cf8' : '#ffffff'} />
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={() => setShowSourceMenu(true)}
            className="mr-3.5 p-1"
          >
            <Globe className="w-6 h-6 text-white" color="#ffffff" />
          </TouchableOpacity>

          <TextInput
            ref={chatInputRef}
            value={newMessage}
            onChangeText={(text) => {
              setNewMessage(text);
              socket.emit('typing', { roomId, username: user?.username });
              if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
              typingTimeoutRef.current = setTimeout(() => {
                socket.emit('stop-typing', { roomId, username: user?.username });
              }, 1500);
            }}
            placeholder="Chat"
            placeholderTextColor="#a3a3a3"
            className="flex-1 text-white text-base py-2 px-1"
          />
          <TouchableOpacity 
            onPress={handleSendMessage}
            disabled={!newMessage.trim()}
            className="p-2 ml-2"
          >
            <Send className={`w-5 h-5 ${newMessage.trim() ? 'text-white' : 'text-white/60'}`} color={newMessage.trim() ? '#ffffff' : 'rgba(255, 255, 255, 0.6)'} />
          </TouchableOpacity>
        </View>

      </View>
      )}

      <MiniBrowser
        visible={showMiniBrowser}
        roomId={roomId}
        isHost={isHost}
        initialUri={roomData?.video_actual?.browserUrl || 'https://duckduckgo.com'}
        onClose={() => setShowMiniBrowser(false)}
        onAddToQueue={(browserItem) => {
          const video = {
            id: 'browser_sync',
            titulo: browserItem.title || browserItem.url,
            miniatura: `https://www.google.com/s2/favicons?domain=${browserItem.url}&sz=128`,
            browserUrl: browserItem.url,
          };
          // Misma lógica: si hay algo PLAYING → cola, si no → reproducir directo
          const isCurrentlyPlaying =
            roomData?.video_actual?.id &&
            roomData.video_actual.id !== '' &&
            roomData.video_actual.state === 'PLAYING';
          if (isCurrentlyPlaying) {
            socket.emit('add-to-queue', { roomId, video, username: user?.username });
          } else {
            socket.emit('change-video', { roomId, video });
          }
          setShowMiniBrowser(false);
        }}
      />


      </Pressable>
      </KeyboardAvoidingView>

      {/* OVERLAY DEL NAVEGADOR DE YOUTUBE (ESTILO RAVE - MODAL COMPLETO) */}
      <Modal
        visible={showYtBrowser}
        animationType="slide"
        onRequestClose={() => setShowYtBrowser(false)}
      >
        <SafeAreaView className="flex-1 bg-dark-900">
          <View className="flex-row items-center justify-between p-5 border-b border-white/5 bg-dark-800">
            <View>
              <Text className="text-white font-black text-sm">YouTube integrado</Text>
              <Text className="text-gray-400 text-[10px] mt-0.5">Navega y selecciona un video para toda la sala</Text>
            </View>
            <TouchableOpacity 
              onPress={() => setShowYtBrowser(false)}
              className="p-2 bg-dark-900 border border-white/10 rounded-xl"
            >
              <X className="w-5 h-5 text-white" color="#ffffff" />
            </TouchableOpacity>
          </View>
          <WebView
            source={{ uri: 'https://m.youtube.com' }}
            injectedJavaScript={ytInjectedScript}
            onMessage={handleYtMessage}
            allowsInlineMediaPlayback={true}
            className="flex-1"
          />
        </SafeAreaView>
      </Modal>

      {/* PANEL DE PARTICIPANTES */}
      <Modal visible={showParticipants} transparent={true} animationType="slide" onRequestClose={() => setShowParticipants(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setShowParticipants(false)}>
          <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '72%', backgroundColor: '#161616', borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.08)', paddingTop: 60 }} onStartShouldSetResponder={() => true}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' }}>
              <View>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>Participantes</Text>
                <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>{participants.length} en la sala</Text>
              </View>
              <TouchableOpacity onPress={() => setShowParticipants(false)} style={{ padding: 6 }}>
                <X size={20} color="#ffffff" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12 }}>
              {participants.length === 0 ? (
                <View style={{ alignItems: 'center', paddingTop: 40, opacity: 0.4 }}>
                  <Users size={32} color="#fff" />
                  <Text style={{ color: '#aaa', marginTop: 10, fontSize: 12, fontWeight: '700' }}>Sin participantes</Text>
                </View>
              ) : (
                participants.map((p, idx) => {
                  const isThisHost = p.username === roomData?.creador || p.username === roomData?.original_creador;
                  const isMe = p.username === user?.username;
                  return (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' }}>
                      <View style={{ position: 'relative' }}>
                        <Image source={{ uri: p.avatarUrl || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(p.username) + '&background=6366f1&color=fff&bold=true') }} style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: isThisHost ? '#6366f1' : 'rgba(255,255,255,0.1)' }} />
                        {isThisHost && <View style={{ position: 'absolute', bottom: -2, right: -2, backgroundColor: '#6366f1', borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 9 }}>👑</Text></View>}
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{p.username}</Text>
                          {isMe && <Text style={{ color: '#6366f1', fontSize: 9, fontWeight: '900', backgroundColor: 'rgba(99,102,241,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 }}>TU</Text>}
                        </View>
                        {isThisHost && <Text style={{ color: '#6366f1', fontSize: 10, fontWeight: '700', marginTop: 1 }}>Admin de sala</Text>}
                      </View>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* MENU DE FUENTE DE VIDEO */}
      <Modal visible={showSourceMenu} transparent={true} animationType="fade" onRequestClose={() => setShowSourceMenu(false)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-start', paddingTop: 70, paddingHorizontal: 16 }} activeOpacity={1} onPress={() => setShowSourceMenu(false)}>
          <View style={{ backgroundColor: '#1a1a1a', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }} onStartShouldSetResponder={() => true}>
            
            {/* Botones de fuentes */}
            <Text style={{ color: '#666', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 2, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>Elegir fuente</Text>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', gap: 14 }} onPress={() => { setShowSourceMenu(false); setShowYtBrowser(true); }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#FF0000', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 18, color: '#fff' }}>▶</Text>
              </View>
              <View>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>YouTube</Text>
                <Text style={{ color: '#888', fontSize: 11, marginTop: 1 }}>Busca y reproduce videos</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', gap: 14 }} onPress={() => { setShowSourceMenu(false); setShowMiniBrowser(true); }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' }}>
                <Globe size={20} color="#fff" />
              </View>
              <View>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Navegador</Text>
                <Text style={{ color: '#888', fontSize: 11, marginTop: 1 }}>Cuevana, Netflix y mas</Text>
              </View>
            </TouchableOpacity>

            {/* Cola de reproducción */}
            <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12, letterSpacing: 0.5, flex: 1 }}>
                  🎵 Cola de reproducción
                </Text>
                {queue.length > 0 && (
                  <View style={{ backgroundColor: '#6366f1', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>{queue.length}</Text>
                  </View>
                )}
              </View>
              {queue.length === 0 ? (
                <Text style={{ color: '#555', fontSize: 12, textAlign: 'center', paddingVertical: 12, paddingBottom: 16 }}>La cola está vacía</Text>
              ) : (
                queue.slice(0, 5).map((item, idx) => (
                  <View key={item.queueId || idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <Text style={{ color: '#555', fontSize: 11, fontWeight: '800', width: 16 }}>{idx + 1}</Text>
                    <Image source={{ uri: item.miniatura }} style={{ width: 52, height: 34, borderRadius: 6, backgroundColor: '#333' }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 16 }} numberOfLines={1}>{item.titulo}</Text>
                      <Text style={{ color: '#6366f1', fontSize: 10, marginTop: 1 }}>por {item.addedBy}</Text>
                    </View>
                  </View>
                ))
              )}
              {queue.length > 5 && (
                <Text style={{ color: '#555', fontSize: 11, textAlign: 'center', paddingBottom: 8 }}>+{queue.length - 5} más en cola</Text>
              )}
            </View>

            <TouchableOpacity style={{ alignItems: 'center', paddingVertical: 13, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }} onPress={() => setShowSourceMenu(false)}>
              <Text style={{ color: '#888', fontSize: 13, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

    </SafeAreaView>
  );
};

export default Room;
