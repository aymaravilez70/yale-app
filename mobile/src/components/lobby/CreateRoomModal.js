import React, { useState, useRef } from 'react';
import { Text, View, TextInput, TouchableOpacity, Image, ScrollView, Modal, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Search, X, Play, Globe, ArrowLeft, Tv, Film, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react-native';
import socket from '../../config/socket';
import { API_BASE_URL } from '../../config/config';
import {
  getStreamingPlatform,
  buildBrowserSyncVideo,
  KICK_LIVE_DETECT_SCRIPT,
} from '../../constants/streamingPlatforms';

const adBlockedDomains = [];

const videoStreamingDomains = [
  'minochinos.com', 'filemoon', 'streamwish', 'voe.sx', 'mixdrop', 
  'doodstream', 'dood.', 'fembed', 'feurl', 'streamtape', 'supervideo', 
  'upstream', 'vidoza', 'netu.tv', 'waaw', 'vev.io', 'wissembed', 'streamhide',
  'rapidvideo', 'openload', 'vcloud', 'videobin', 'maxstream',
  'gscdn.cam', 'gscdn', 'vidmoly', 'tomatomoon', 'slmaxed', 'streamrub',
  'streamvid', 'embed.cam', 'filelions', 'streamlare', 'streamhub', 'vidsrc'
];

function extractRealVideoUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    const isDirectVideoDomain = videoStreamingDomains.some(domain => hostname.includes(domain));
    if (isDirectVideoDomain) {
      return url;
    }
    
    // Buscar en los query params
    const searchParams = urlObj.searchParams;
    for (const [key, value] of searchParams.entries()) {
      if (value.startsWith('http://') || value.startsWith('https://')) {
        try {
          const valueUrlObj = new URL(value);
          const valueHostname = valueUrlObj.hostname.toLowerCase();
          if (videoStreamingDomains.some(domain => valueHostname.includes(domain))) {
            console.log(`🎯 [Video Extractor] Extraída URL de video real de parámetro "${key}":`, value);
            return value;
          }
        } catch(err) {}
      }
    }
    
    // Fallback: decodificar sub-urls
    for (const domain of videoStreamingDomains) {
      if (url.toLowerCase().includes(domain)) {
        const index = url.toLowerCase().indexOf('http');
        if (index >= 0) {
          const subUrlPart = url.substring(index);
          const decoded = decodeURIComponent(subUrlPart);
          if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
            try {
              const decodedUrlObj = new URL(decoded);
              if (decodedUrlObj.hostname.toLowerCase().includes(domain)) {
                console.log(`🎯 [Video Extractor] Extraída URL de video decodificada:`, decoded);
                return decoded;
              }
            } catch(err) {}
          }
        }
      }
    }
  } catch (e) {
    console.warn("[Video Extractor] Error extrayendo URL:", e);
  }
  return null;
}

const CreateRoomModal = ({ visible, user, onClose, onCreateSuccess }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [showYtBrowser, setShowYtBrowser] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);
  const [currentBrowserUrl, setCurrentBrowserUrl] = useState('https://duckduckgo.com');
  const [currentBrowserTitle, setCurrentBrowserTitle] = useState('Navegador Web');
  const [currentBrowserPoster, setCurrentBrowserPoster] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  
  const webViewRef = useRef(null);
  const canGoBackRef = useRef(false);
  const lastLegitimateUrlRef = useRef('https://duckduckgo.com');
  const isCreatingRef = useRef(false);

  // Resetear el lock al abrir o cerrar el modal
  React.useEffect(() => {
    if (visible) {
      isCreatingRef.current = false;
      processingKickRef.current = null;
    }
  }, [visible]);

  const processingKickRef = React.useRef(null);

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
        // NO reseteamos lastSentVideoId para evitar duplicados en navegaciones intermedias
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
          console.log("🛡️ [Yale Dialog Shield] Interceptado window.confirm('" + msg + "'). Retornando true (Aceptar automáticamente).");
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
        
        // Interceptar métodos originales de localStorage para retornar siempre null/vacío
        localStorage.getItem = function(key) {
          console.log("🚫 [Yale Storage Shield] Bloqueada lectura de localStorage para key: " + key + " (retornado null)");
          return null;
        };
        localStorage.setItem = function(key, value) {
          console.log("🚫 [Yale Storage Shield] Bloqueada escritura de localStorage para key: " + key + " (valor ignorado)");
        };
        localStorage.removeItem = function(key) {
          console.log("🚫 [Yale Storage Shield] removeItem interceptado para: " + key);
        };
        localStorage.clear = function() {
          console.log("🚫 [Yale Storage Shield] clear interceptado");
        };

        // Interceptar métodos originales de sessionStorage para retornar siempre null/vacío
        sessionStorage.getItem = function(key) {
          console.log("🚫 [Yale Storage Shield] Bloqueada lectura de sessionStorage para key: " + key + " (retornado null)");
          return null;
        };
        sessionStorage.setItem = function(key, value) {
          console.log("🚫 [Yale Storage Shield] Bloqueada escritura de sessionStorage para key: " + key + " (valor ignorado)");
        };
        sessionStorage.removeItem = function(key) {
          console.log("🚫 [Yale Storage Shield] removeItem interceptado para: " + key);
        };
        sessionStorage.clear = function() {
          console.log("🚫 [Yale Storage Shield] clear interceptado");
        };

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
        const origCookieGet = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie').get;
        const origCookieSet = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie').set;
        
        Object.defineProperty(document, 'cookie', {
          get: function() {
            return origCookieGet.call(document);
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
              const isCF = name.startsWith('__cf') || name.startsWith('cf_');
              if (isCF) {
                origCookieSet.call(document, val);
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
            origCookieSet.call(document, val);
          },
          configurable: true
        });

        // Limpiar todas las cookies de la página que no sean de Cloudflare
        try {
          const cookies = document.cookie.split(";");
          for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i];
            const eqPos = cookie.indexOf("=");
            const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
            const isCF = name.startsWith('__cf') || name.startsWith('cf_');
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
      
      console.log("🌐 Yale Console Logger inicializado en: " + window.location.href);
    })();
    true;
  `;

  const adBlockScript = `
    true;
  `;
  const generalVideoDetectorScript = `
    (function() {
      function log(msg) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'CONSOLE_LOG',
            message: '[' + (window.self === window.top ? 'MainFrame' : 'Iframe: ' + window.location.host) + '] ' + msg
          }));
        } catch(e) {}
      }

      log("Detector de video inyectado correctamente.");

      let detected = false;
      let scanCounter = 0;
      let videoCounter = 0;

      const videoDomains = [
        'minochinos.com', 'filemoon', 'streamwish', 'voe.sx', 'mixdrop', 
        'doodstream', 'dood.', 'fembed', 'feurl', 'streamtape', 'supervideo', 
        'upstream', 'vidoza', 'netu.tv', 'waaw', 'vev.io', 'wissembed', 'streamhide',
        'rapidvideo', 'openload', 'vcloud', 'videobin', 'maxstream',
        'gscdn.cam', 'gscdn', 'vidmoly', 'tomatomoon', 'slmaxed', 'streamrub',
        'streamvid', 'embed.cam', 'filelions', 'streamlare', 'streamhub', 'vidsrc'
      ];

      function getPageMetadata() {
        let title = '';
        let poster = '';
        try {
          // 1. Título
          const ogTitle = document.querySelector('meta[property="og:title"]');
          const twTitle = document.querySelector('meta[name="twitter:title"]');
          if (ogTitle && ogTitle.content) {
            title = ogTitle.content.trim();
          } else if (twTitle && twTitle.content) {
            title = twTitle.content.trim();
          } else {
            title = document.title || '';
          }

          if (title) {
            title = title
              .replace(/ - Cuevana\s?\d*/i, '')
              .replace(/Cuevana\s?\d*\s?-\s?/i, '')
              .replace(/Ver\s+/i, '')
              .replace(/\s+Online\s+Gratis.*/i, '')
              .replace(/\s+en\s+Español.*/i, '')
              .replace(/\s+-\s+Peliculas.*/i, '')
              .replace(/\s+-\s+Series.*/i, '')
              .replace(/\s+-\s+Cuevana\s?\d*\s?.*/i, '')
              .trim();
          }

          // 2. Póster
          const ogImg = document.querySelector('meta[property="og:image"]');
          const twImg = document.querySelector('meta[name="twitter:image"]');
          const linkImg = document.querySelector('link[rel="image_src"]');
          
          if (ogImg && ogImg.content) {
            poster = ogImg.content.trim();
          } else if (twImg && twImg.content) {
            poster = twImg.content.trim();
          } else if (linkImg && linkImg.href) {
            poster = linkImg.href.trim();
          } else {
            const imgSelectors = [
              '.wp-post-image',
              '.post-thumbnail img',
              'img[src*="cover"]',
              'img[src*="poster"]',
              '.movie-poster img',
              '.poster img',
              '#poster img',
              '.imagen-pelicula img',
              '.cap-portada img',
              '.backdrop img'
            ];
            for (const selector of imgSelectors) {
              const img = document.querySelector(selector);
              if (img && img.src) {
                poster = img.src;
                break;
              }
            }
          }

          if (poster && !poster.startsWith('http')) {
            try {
              poster = new URL(poster, window.location.href).href;
            } catch(e) {}
          }
        } catch(err) {
          log("Error en getPageMetadata: " + err.message);
        }
        return { title, poster };
      }
      
      // Si estamos en el MainFrame, escuchar mensajes de burbujeo de los subframes
      if (window.self === window.top) {
        window.addEventListener('message', (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'IFRAME_VIDEO_PLAY_DETECTED' && !detected) {
              detected = true;
              log("Burbujeo: Video detectado en subframe (" + data.url + "). Creando sala...");
              
              let mainTitle = data.title;
              let mainPoster = data.poster || '';
              try {
                const meta = getPageMetadata();
                if (meta.title) mainTitle = meta.title;
                if (meta.poster) mainPoster = meta.poster;
              } catch(metaErr) {}

              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'VIDEO_PLAY_DETECTED',
                url: data.url,
                title: mainTitle,
                poster: mainPoster
              }));
            }
          } catch(err) {}
        });

        // DETECTAR CLICKS EN REPRODUCTORES CROSS-ORIGIN USANDO BLUR DEL WINDOW
        window.addEventListener('blur', () => {
          setTimeout(() => {
            if (document.activeElement && 
                (document.activeElement.isVideoPlayer || document.activeElement.dataset.videoPlayer === "true") && 
                !detected) {
              
              const iframe = document.activeElement;
              const src = iframe.src || '';
              
              let realUrl = src;
              try {
                const urlObj = new URL(src);
                for (const [key, value] of urlObj.searchParams.entries()) {
                  if (value.startsWith('http') && videoDomains.some(domain => value.toLowerCase().includes(domain))) {
                    realUrl = value;
                    break;
                  }
                }
              } catch(e) {}

              detected = true;
              log("Detección de Click en Iframe: El usuario interactuó con el reproductor de video: " + realUrl + ". Creando sala...");

              let title = document.title || 'Video Sincronizado';
              let poster = '';
              try {
                const meta = getPageMetadata();
                if (meta.title) title = meta.title;
                if (meta.poster) poster = meta.poster;
              } catch(metaErr) {}

              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'VIDEO_PLAY_DETECTED',
                url: realUrl,
                title: title,
                poster: poster
              }));
            }
          }, 150);
        });
      }
      
      // DOM Scanning para buscar iframes con URLs de servidores de video conocidos
      function scanIframes() {
        if (detected) return;
        try {
          const iframes = document.querySelectorAll('iframe');
          scanCounter++;
          if (iframes.length > 0 && scanCounter % 5 === 0) {
            const srcList = Array.from(iframes).map(i => i.src || '(sin src)').join(', ');
            log("DOM Scanning: Encontrados " + iframes.length + " iframe(s): [" + srcList + "]");
          }
          iframes.forEach((iframe) => {
            const src = iframe.src || '';
            if (src) {
              const containsVideo = videoDomains.some(domain => src.toLowerCase().includes(domain));
              if (containsVideo && !detected) {
                // Etiquetar el iframe como reproductor de video legítimo
                iframe.isVideoPlayer = true;
                iframe.dataset.videoPlayer = "true";
                if (!iframe.loggedDiscovery) {
                  iframe.loggedDiscovery = true;
                  log("DOM Scanning: Cargado iframe de video legítimo: " + src + ". Esperando click de Play del usuario...");
                }
              }
            }
          });
        } catch (e) {
          log("Error en scanIframes: " + e.message);
        }
      }
      
      function bindVideoPlay() {
        if (detected) return;
        const videos = document.querySelectorAll('video');
        videoCounter++;
        if (videos.length > 0 && videoCounter % 5 === 0) {
          log("bindVideoPlay: Encontrados " + videos.length + " elemento(s) <video> en " + window.location.href);
        }
        
        videos.forEach((v, index) => {
          if (!v.paused && v.currentTime > 0 && !detected) {
            log("Video #" + index + " detectado ya reproduciéndose (currentTime: " + v.currentTime + "). Creando sala...");
            triggerSelect(v);
          }
          
          if (!v.hasPlayListener) {
            v.hasPlayListener = true;
            v.addEventListener('play', () => {
              log("Play detectado en Video #" + index + "!");
              if (!detected) {
                triggerSelect(v);
              }
            });
            log("Listener 'play' agregado a Video #" + index);
          }
        });
      }

      function triggerSelect(videoElement) {
        detected = true;
        const pageUrl = window.location.href;
        
        let title = document.title || 'Video Sincronizado';
        let poster = '';
        try {
          const meta = getPageMetadata();
          if (meta.title) title = meta.title;
          if (meta.poster) poster = meta.poster;
        } catch(metaErr) {}

        log("Seleccionando URL: " + pageUrl + " (Título: " + title + ")");
        
        // Enviar directamente a React Native
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'VIDEO_PLAY_DETECTED',
            url: pageUrl,
            title: title,
            poster: poster
          }));
        } catch(e) {}
        
        // Y burbujear al MainFrame por si es un subframe cruzado
        try {
          window.parent.postMessage(JSON.stringify({
            type: 'IFRAME_VIDEO_PLAY_DETECTED',
            url: pageUrl,
            title: title,
            poster: poster
          }), '*');
        } catch(e) {}
      }

      document.addEventListener('click', (e) => {
        log("Click detectado en elemento: <" + e.target.tagName + "> clase: '" + e.target.className + "'");
      }, true);

      // Enviar metadatos periódicamente al MainFrame
      if (window.self === window.top) {
        function sendMetadata() {
          try {
            const meta = getPageMetadata();
            if (meta.title || meta.poster) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'METADATA_EXTRACTED',
                title: meta.title,
                poster: meta.poster
              }));
            }
          } catch(e) {}
        }
        
        sendMetadata();
        window.addEventListener('DOMContentLoaded', sendMetadata);
        window.addEventListener('load', sendMetadata);
        setInterval(sendMetadata, 1500);
      }

      setInterval(scanIframes, 1000);
      setInterval(bindVideoPlay, 1000);
      
      scanIframes();
      bindVideoPlay();
    })();
    true;
  `;

  const processingVideoIdRef = React.useRef(null);

  const handleYtMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'YOUTUBE_VIDEO_DETECTED') {
        const videoId = data.id;
        // Guard: ignorar si ya estamos procesando este mismo video
        if (processingVideoIdRef.current === videoId) return;
        processingVideoIdRef.current = videoId;

        const thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        fetch(`${API_BASE_URL}/api/youtube/info/${videoId}`)
          .then(r => r.json())
          .then(info => {
            const titulo = (info && info.titulo && info.titulo.trim()) ? info.titulo.trim() : `Video ${videoId}`;
            setShowYtBrowser(false);
            selectVideo({ id: videoId, titulo, miniatura: info.miniatura || thumbnail });
          })
          .catch(() => {
            setShowYtBrowser(false);
            selectVideo({ id: videoId, titulo: `Video ${videoId}`, miniatura: thumbnail });
          })
          .finally(() => {
            setTimeout(() => { processingVideoIdRef.current = null; }, 3000);
          });
      } else if (data.type === 'VIDEO_PLAY_DETECTED') {
        if (selectedApp === 'kick') return;
        setShowYtBrowser(false);
        selectBrowserUrl(data.url, data.title, data.poster || null, 'browser');
      } else if (data.type === 'KICK_STREAM_DETECTED') {
        if (!data.isLive || !data.channel) return;
        const kickKey = data.channel + ':' + (data.url || '');
        if (processingKickRef.current === kickKey) return;
        processingKickRef.current = kickKey;
        setShowYtBrowser(false);
        selectBrowserUrl(
          data.url,
          data.title || data.channel || 'Kick',
          null,
          'kick'
        );
        setTimeout(() => {
          processingKickRef.current = null;
        }, 5000);
      } else if (data.type === 'METADATA_EXTRACTED') {
        if (data.title) {
          setCurrentBrowserTitle(data.title);
        }
        if (data.poster) {
          setCurrentBrowserPoster(data.poster);
        }
      } else if (data.type === 'CONSOLE_LOG') {
        console.log("📱 [WebView Console]:", data.message);
      }
    } catch (e) {
      console.warn("Error parseando mensaje de WebView:", e);
    }
  };


  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/youtube/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      setResults(data);
    } catch (error) {
      console.error("Error buscando videos desde el móvil:", error);
    } finally {
      setLoading(false);
    }
  };

  const selectVideo = (video) => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    console.log("🚀 [MOBILE] Solicitando creación de sala por video:", video.id);

    const roomId = Date.now().toString();
    const nuevaSala = {
      sala_id: roomId,
      creador: user.username,
      privacidad: "Public",
      video_actual: {
        id: video.id,
        titulo: video.titulo,
        miniatura: video.miniatura
      }
    };

    // Emitir creación al servidor de sockets
    socket.emit('crear-sala', nuevaSala);
    
    // Limpiar estados y notificar éxito
    setQuery('');
    setResults([]);
    setSelectedApp(null);
    setShowYtBrowser(false);
    onCreateSuccess(roomId);
  };

  const selectBrowserUrl = (
    url,
    title = 'Navegador Sincronizado',
    poster = null,
    platformId = 'browser'
  ) => {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    console.log('🚀 [MOBILE] Creación de sala embed:', platformId, url);

    const roomId = Date.now().toString();
    const nuevaSala = {
      sala_id: roomId,
      creador: user.username,
      privacidad: 'Public',
      video_actual: buildBrowserSyncVideo({
        url,
        title: title || getStreamingPlatform(platformId).defaultTitle,
        poster: poster || currentBrowserPoster,
        platformId,
      }),
    };

    socket.emit('crear-sala', nuevaSala);
    setSelectedApp(null);
    setShowYtBrowser(false);
    onCreateSuccess(roomId);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/80 justify-end">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="bg-dark-800 rounded-t-[32px] border-t border-white/10 h-[85%]"
        >
                 {selectedApp === null ? (
            <>
              {/* Selector de Apps */}
              <View className="flex-row justify-between items-center p-6 border-b border-white/5">
                <View>
                  <Text className="text-xl font-black text-white">Crear Nueva Sala</Text>
                  <Text className="text-gray-400 text-xs mt-1">Elige una plataforma de streaming</Text>
                </View>
                <TouchableOpacity 
                  onPress={() => {
                    setSelectedApp(null);
                    onClose();
                  }} 
                  className="p-2 bg-dark-900 rounded-full border border-white/5"
                >
                  <X className="w-5 h-5 text-white" color="#ffffff" />
                </TouchableOpacity>
              </View>

              {/* Grid de Apps */}
              <ScrollView className="flex-1 p-6" showsVerticalScrollIndicator={false}>
                <View className="flex-row flex-wrap justify-between gap-y-4 pb-8">
                  {/* YOUTUBE (ACTIVO) */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      setSelectedApp('youtube');
                      setShowYtBrowser(true);
                    }}
                    className="w-[47%] aspect-[1.1] bg-red-600/10 border border-red-500/20 rounded-3xl p-5 justify-between shadow-lg"
                  >
                    <View className="w-12 h-12 bg-red-600 rounded-2xl items-center justify-center shadow-lg shadow-red-600/30">
                      <Play className="w-6 h-6 text-white fill-current" />
                    </View>
                    <View>
                      <Text className="text-white font-black text-base">YouTube</Text>
                      <Text className="text-red-400 text-[10px] font-bold uppercase tracking-wider mt-0.5">Activo</Text>
                    </View>
                  </TouchableOpacity>

                  {/* NAVEGADOR WEB (ACTIVO) */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setSelectedApp('browser')}
                    className="w-[47%] aspect-[1.1] bg-indigo-600/10 border border-indigo-500/20 rounded-3xl p-5 justify-between shadow-lg"
                  >
                    <View className="w-12 h-12 bg-indigo-600 rounded-2xl items-center justify-center shadow-lg shadow-indigo-600/30">
                      <Globe className="w-6 h-6 text-white" />
                    </View>
                    <View>
                      <Text className="text-white font-black text-base">Web Browser</Text>
                      <Text className="text-indigo-400 text-[10px] font-bold uppercase tracking-wider mt-0.5">Activo</Text>
                    </View>
                  </TouchableOpacity>

                  {/* KICK (ACTIVO) */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      setSelectedApp('kick');
                      setCurrentBrowserUrl('https://kick.com');
                      setCurrentBrowserTitle('Kick');
                    }}
                    className="w-[47%] aspect-[1.1] rounded-3xl p-5 justify-between shadow-lg"
                    style={{ backgroundColor: 'rgba(83,252,24,0.08)', borderWidth: 1, borderColor: 'rgba(83,252,24,0.25)' }}
                  >
                    <View
                      className="w-12 h-12 rounded-2xl items-center justify-center"
                      style={{ backgroundColor: '#53FC18' }}
                    >
                      <Text className="text-black font-black text-lg">K</Text>
                    </View>
                    <View>
                      <Text className="text-white font-black text-base">Kick</Text>
                      <Text style={{ color: '#53FC18', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>
                        Activo
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {/* NETFLIX (INACTIVO) */}
                  <View className="w-[47%] aspect-[1.1] bg-dark-900/50 border border-white/5 rounded-3xl p-5 justify-between opacity-50">
                    <View className="w-12 h-12 bg-dark-900 rounded-2xl items-center justify-center">
                      <Tv className="w-6 h-6 text-white" color="#ffffff" />
                    </View>
                    <View>
                      <Text className="text-gray-400 font-bold text-base">Netflix</Text>
                      <Text className="text-gray-600 text-[9px] font-black uppercase tracking-wider mt-0.5">Próximamente</Text>
                    </View>
                  </View>

                  {/* PRIME VIDEO (INACTIVO) */}
                  <View className="w-[47%] aspect-[1.1] bg-dark-900/50 border border-white/5 rounded-3xl p-5 justify-between opacity-50">
                    <View className="w-12 h-12 bg-dark-900 rounded-2xl items-center justify-center">
                      <Tv className="w-6 h-6 text-white" color="#ffffff" />
                    </View>
                    <View>
                      <Text className="text-gray-400 font-bold text-base">Prime Video</Text>
                      <Text className="text-gray-600 text-[9px] font-black uppercase tracking-wider mt-0.5">Próximamente</Text>
                    </View>
                  </View>

                  {/* DISNEY+ (INACTIVO) */}
                  <View className="w-[47%] aspect-[1.1] bg-dark-900/50 border border-white/5 rounded-3xl p-5 justify-between opacity-50">
                    <View className="w-12 h-12 bg-dark-900 rounded-2xl items-center justify-center">
                      <Film className="w-6 h-6 text-white" color="#ffffff" />
                    </View>
                    <View>
                      <Text className="text-gray-400 font-bold text-base">Disney+</Text>
                      <Text className="text-gray-600 text-[9px] font-black uppercase tracking-wider mt-0.5">Próximamente</Text>
                    </View>
                  </View>

                  {/* MAX (INACTIVO) */}
                  <View className="w-[47%] aspect-[1.1] bg-dark-900/50 border border-white/5 rounded-3xl p-5 justify-between opacity-50">
                    <View className="w-12 h-12 bg-dark-900 rounded-2xl items-center justify-center">
                      <Film className="w-6 h-6 text-white" color="#ffffff" />
                    </View>
                    <View>
                      <Text className="text-gray-400 font-bold text-base">HBO Max</Text>
                      <Text className="text-gray-600 text-[9px] font-black uppercase tracking-wider mt-0.5">Próximamente</Text>
                    </View>
                  </View>
                </View>
              </ScrollView>
            </>
          ) : selectedApp === 'browser' || selectedApp === 'kick' ? (
            <>
              {/* Web Browser Selector Header */}
              <View className="flex-row justify-between items-center p-6 border-b border-white/5">
                <View className="flex-row items-center gap-3">
                  <TouchableOpacity 
                    onPress={() => setSelectedApp(null)}
                    className="p-2 bg-dark-900 rounded-xl border border-white/5"
                  >
                    <ArrowLeft className="w-4 h-4 text-white" color="#ffffff" />
                  </TouchableOpacity>
                  <View>
                    <Text className="text-xl font-black text-white">
                      {selectedApp === 'kick' ? 'Kick' : 'Navegador Web'}
                    </Text>
                    <Text className="text-gray-400 text-xs mt-0.5">
                      {selectedApp === 'kick'
                        ? 'Abre un canal en vivo y sincroniza con la sala'
                        : 'Navega y comparte cualquier web'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity 
                  onPress={() => {
                    setSelectedApp(null);
                    onClose();
                  }} 
                  className="p-2 bg-dark-900 rounded-full border border-white/5"
                >
                  <X className="w-5 h-5 text-white" color="#ffffff" />
                </TouchableOpacity>
              </View>

              {/* Botón para lanzar navegador */}
              <View className="flex-1 p-6 items-center justify-center">
                <View className="w-16 h-16 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl items-center justify-center mb-4">
                  <Globe className="w-8 h-8 text-indigo-500" />
                </View>
                <Text className="text-white text-lg font-black text-center">
                  {selectedApp === 'kick' ? 'Kick en vivo' : 'Navegador Web Sincronizado'}
                </Text>
                <Text className="text-gray-400 text-xs text-center mt-2 px-6 leading-relaxed">
                  {selectedApp === 'kick'
                    ? 'Abre el canal de un stream EN VIVO. La sala se crea sola cuando detecte la transmisión.'
                    : 'Entra a cualquier sitio web de videos y sincroniza la reproducción en vivo con tus amigos.'}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    if (selectedApp === 'kick') {
                      setCurrentBrowserUrl('https://kick.com');
                      setCurrentBrowserTitle('Kick');
                    }
                    setShowYtBrowser(true);
                  }}
                  className="mt-8 py-3.5 px-8 rounded-2xl flex-row items-center gap-2 shadow-lg"
                  style={{
                    backgroundColor: selectedApp === 'kick' ? '#53FC18' : '#6366f1',
                  }}
                >
                  {selectedApp === 'kick' ? (
                    <Text className="text-black font-black text-xs uppercase tracking-widest">
                      Abrir Kick
                    </Text>
                  ) : (
                    <>
                      <Globe className="w-4 h-4 text-white" />
                      <Text className="text-white font-black text-xs uppercase tracking-widest">
                        Abrir Navegador Web
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* Modal del Navegador */}
              <Modal
                visible={showYtBrowser}
                animationType="slide"
                onRequestClose={() => {
                  setShowYtBrowser(false);
                  setSelectedApp(null);
                }}
              >
                <SafeAreaView className="flex-1 bg-dark-900">
                  {/* BARRA DE NAVEGACIÓN SUPERIOR (ESTILO BRAVE PREMIUM) */}
                  <View className="flex-row items-center bg-dark-800 border-b border-white/5 p-3 gap-2">
                    
                    {/* Botones de Navegación del Navegador (A la Izquierda) */}
                    <View className="flex-row gap-1">
                      <TouchableOpacity 
                        onPress={() => {
                          if (canGoBack && webViewRef.current) {
                            webViewRef.current.goBack();
                          }
                        }}
                        disabled={!canGoBack}
                        className={`p-2 rounded-xl bg-dark-900 ${!canGoBack ? 'opacity-30' : ''}`}
                      >
                        <ChevronLeft className="w-5 h-5 text-white" color="#ffffff" />
                      </TouchableOpacity>
                      
                      <TouchableOpacity 
                        disabled={!canGoForward}
                        onPress={() => webViewRef.current?.goForward()}
                        className={`p-2 rounded-xl bg-dark-900 ${!canGoForward ? 'opacity-30' : ''}`}
                      >
                        <ChevronRight className="w-5 h-5 text-white" color="#ffffff" />
                      </TouchableOpacity>
                      
                      <TouchableOpacity 
                        onPress={() => webViewRef.current?.reload()}
                        className="p-2 rounded-xl bg-dark-900"
                      >
                        <RotateCw className="w-4 h-4 text-white" color="#ffffff" />
                      </TouchableOpacity>
                    </View>

                    {/* Título o URL (En el Centro) */}
                    <View className="flex-1 px-2 justify-center">
                      <Text className="text-white font-black text-xs" numberOfLines={1}>
                        {currentBrowserTitle || 'Navegador Web'}
                      </Text>
                      <Text className="text-gray-400 text-[9px]" numberOfLines={1}>
                        {currentBrowserUrl || 'Navegando...'}
                      </Text>
                    </View>

                    {/* Botón de Cerrar (A la Derecha - BLANCO) */}
                    <TouchableOpacity 
                      onPress={() => {
                        setShowYtBrowser(false);
                        setSelectedApp(null);
                      }}
                      className="p-2 bg-dark-900 border border-white/10 rounded-xl"
                    >
                      <X className="w-5 h-5 text-white" color="#ffffff" />
                    </TouchableOpacity>
                  </View>

                  <View className="flex-1 relative">
                    {showYtBrowser && (
                      <WebView
                        ref={webViewRef}
                        source={{
                          uri:
                            selectedApp === 'kick'
                              ? 'https://kick.com'
                              : 'https://duckduckgo.com',
                        }}
                        injectedJavaScriptBeforeContentLoaded={beforeContentScript}
                        injectedJavaScript={
                          selectedApp === 'kick'
                            ? KICK_LIVE_DETECT_SCRIPT + adBlockScript
                            : ytInjectedScript +
                              adBlockScript +
                              generalVideoDetectorScript
                        }
                        injectedJavaScriptForMainFrameOnly={false}
                        injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
                        onNavigationStateChange={(navState) => {
                          setCurrentBrowserUrl(navState.url);
                          setCurrentBrowserTitle(navState.title || 'Navegador Web');
                          setCanGoBack(navState.canGoBack);
                          canGoBackRef.current = navState.canGoBack;
                          setCanGoForward(navState.canGoForward);
                          
                          // Registrar última URL
                          const url = navState.url;
                          if (url && !url.startsWith('about:')) {
                            lastLegitimateUrlRef.current = url;
                          }

                          // Limpiar el póster si volvemos a un buscador o página de inicio
                          if (url && (url.includes('duckduckgo.com') || url.includes('google.com') || url === 'https://duckduckgo.com' || url === 'https://duckduckgo.com/')) {
                            setCurrentBrowserPoster('');
                          }
                        }}
                        onShouldStartLoadWithRequest={(request) => {
                          const url = request.url;
                          console.log("🔍 [CreateRoomModal Network] Petición de carga detectada:", url);

                          if (url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) {
                            return true;
                          }

                          if (!url.startsWith('http://') && !url.startsWith('https://')) {
                            console.log("🚫 Standalone AdBlocker: Esquema no HTTP bloqueado:", url);
                            return false;
                          }

                          return true;
                        }}
                        onMessage={handleYtMessage}
                        allowsInlineMediaPlayback={true}
                        domStorageEnabled={true}
                        javaScriptEnabled={true}
                        mixedContentMode="always"
                        incognito={true}
                        cacheEnabled={false}
                        cacheMode="LOAD_NO_CACHE"
                        className="flex-1"
                      />
                    )}
                  </View>
                </SafeAreaView>
              </Modal>
            </>
          ) : (
            <>
              {/* Modal del Navegador YouTube (Lanzado directamente) */}
              <Modal
                visible={showYtBrowser}
                animationType="slide"
                onRequestClose={() => {
                  setShowYtBrowser(false);
                  setSelectedApp(null);
                }}
              >
                <SafeAreaView className="flex-1 bg-dark-900">
                  <View className="flex-row items-center justify-between p-5 border-b border-white/5 bg-dark-800">
                    <View>
                      <Text className="text-white font-black text-sm">YouTube integrado</Text>
                      <Text className="text-gray-400 text-[10px] mt-0.5">Navega y selecciona un video para tu sala</Text>
                    </View>
                    <TouchableOpacity 
                      onPress={() => {
                        setShowYtBrowser(false);
                        setSelectedApp(null);
                      }}
                      className="p-2 bg-dark-900 border border-white/10 rounded-xl"
                    >
                      <X className="w-5 h-5 text-white" color="#ffffff" />
                    </TouchableOpacity>
                  </View>
                  {showYtBrowser && (
                    <WebView
                      source={{ uri: 'https://m.youtube.com' }}
                      injectedJavaScriptBeforeContentLoaded={beforeContentScript}
                      injectedJavaScript={ytInjectedScript + adBlockScript}
                      onMessage={handleYtMessage}
                      allowsInlineMediaPlayback={true}
                      domStorageEnabled={true}
                      javaScriptEnabled={true}
                      mixedContentMode="always"
                      incognito={true}
                      cacheEnabled={false}
                      cacheMode="LOAD_NO_CACHE"
                      className="flex-1"
                    />
                  )}
                </SafeAreaView>
              </Modal>
            </>
          )}

        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

export default CreateRoomModal;
