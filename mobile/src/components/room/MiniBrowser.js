import React, { useState, useRef, useEffect } from 'react';
import { Text, View, TextInput, TouchableOpacity, SafeAreaView, ActivityIndicator, Modal, BackHandler, ToastAndroid, Platform, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { ChevronLeft, ChevronRight, RotateCw, X, Globe, PlusCircle } from 'lucide-react-native';
import socket from '../../config/socket';

const adBlockedDomains = [];

const MiniBrowser = ({ visible, roomId, isHost, onClose, initialUri = 'https://duckduckgo.com', onAddToQueue }) => {
  const [uri, setUri] = useState(initialUri);
  const [inputUrl, setInputUrl] = useState(initialUri);
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  
  const webViewRef = useRef(null);
  const canGoBackRef = useRef(false);
  const lastEmittedUrlRef = useRef(initialUri);
  const isManualNavigationRef = useRef(false);
  const lastLegitimateUrlRef = useRef(initialUri);

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
      
      console.log("🌐 Yale Console Logger (MiniBrowser) inicializado en: " + window.location.href);
    })();
    true;
  `;

  const adBlockScript = `
    true;
  `;

  // Script de Inyección para monitorear videos HTML5 en el host y sincronizar invitados en subframes
  const monitoringScript = `
    (function() {
      let video = null;
      let lastEventTime = 0;
      const isHost = ${isHost ? 'true' : 'false'};

      function bindEvents() {
        const v = document.querySelector('video');
        if (v && v !== video) {
          video = v;
          console.log("📹 Yale Injected JS: Video elemento encontrado en: " + window.location.href);

          if (isHost) {
            // Eventos del Host para transmitir a la sala
            video.addEventListener('play', () => {
              if (Date.now() - lastEventTime > 800) {
                lastEventTime = Date.now();
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'PLAY',
                  currentTime: video.currentTime
                }));
              }
            });

            video.addEventListener('pause', () => {
              if (Date.now() - lastEventTime > 800) {
                lastEventTime = Date.now();
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'PAUSE',
                  currentTime: video.currentTime
                }));
              }
            });

            video.addEventListener('seeking', () => {
              if (Date.now() - lastEventTime > 800) {
                lastEventTime = Date.now();
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'SEEK',
                  currentTime: video.currentTime
                }));
              }
            });
          }
        }
      }

      // Escuchar eventos SYNC desde el frame principal (para invitados)
      window.addEventListener('message', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'SYNC') {
            const v = document.querySelector('video');
            if (v) {
              console.log("📹 Sincronizando video en iframe a:", data.state, "@", data.currentTime);
              if (data.state === 'PLAYING') {
                if (Math.abs(v.currentTime - data.currentTime) > 3) {
                  v.currentTime = data.currentTime;
                }
                v.play().catch(() => {});
              } else if (data.state === 'PAUSED') {
                v.pause();
                if (Math.abs(v.currentTime - data.currentTime) > 3) {
                  v.currentTime = data.currentTime;
                }
              }
            }
          }
        } catch(err) {}
      });

      // Buscar videos continuamente cada 1.5s
      setInterval(bindEvents, 1500);
      bindEvents();
    })();
    true;
  `;

  const combinedScript = adBlockScript + monitoringScript;

  // 0. Sincronizar URL inicial dinámicamente si cambia
  useEffect(() => {
    if (initialUri) {
      setUri(initialUri);
      setInputUrl(initialUri);
    }
  }, [initialUri]);


  // 1. Escuchar eventos de la sala de Yale para sincronizar invitados
  useEffect(() => {
    if (!visible) return;

    const handleVideoSync = ({ state, currentTime }) => {
      // Los invitados son controlados por el Host
      if (!isHost && webViewRef.current) {
        console.log(`📱 Invitado sincronizado a: ${state} @ ${currentTime}s`);
        
        const jsCode = `
          (function() {
            // 1. Sincronizar video local del frame principal (si existe)
            const v = document.querySelector('video');
            if (v) {
              if ('${state}' === 'PLAYING') {
                if (Math.abs(v.currentTime - ${currentTime}) > 3) {
                  v.currentTime = ${currentTime};
                }
                v.play().catch(() => {});
              } else if ('${state}' === 'PAUSED') {
                v.pause();
                if (Math.abs(v.currentTime - ${currentTime}) > 3) {
                  v.currentTime = ${currentTime};
                }
              }
            }
            
            // 2. Reenviar el comando SYNC a todos los iframes del documento
            document.querySelectorAll('iframe').forEach(iframe => {
              try {
                iframe.contentWindow.postMessage(JSON.stringify({
                  type: 'SYNC',
                  state: '${state}',
                  currentTime: ${currentTime}
                }), '*');
              } catch(e) {}
            });
          })();
          true;
        `;
        
        webViewRef.current.injectJavaScript(jsCode);
      }
    };

    const handleBrowserNavigation = ({ url }) => {
      if (!isHost) {
        console.log("📡 Invitado sigue navegación del host a:", url);
        setUri(url);
        setInputUrl(url);
      }
    };

    socket.on('video-state-update', handleVideoSync);
    socket.on('browser-navigation-update', handleBrowserNavigation);
    
    return () => {
      socket.off('video-state-update', handleVideoSync);
      socket.off('browser-navigation-update', handleBrowserNavigation);
    };
  }, [visible, isHost]);

  if (!visible) return null;

  // 2. Controlar la barra de búsqueda y navegación
  const handleNavigate = () => {
    let finalUrl = inputUrl.trim();
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
        finalUrl = 'https://' + finalUrl;
      } else {
        // Si no es URL, busca en DuckDuckGo
        finalUrl = `https://duckduckgo.com/?q=${encodeURIComponent(finalUrl)}`;
      }
    }
    isManualNavigationRef.current = true;
    setUri(finalUrl);
    setInputUrl(finalUrl);
  };

  // 3. Capturar eventos enviados desde la WebView (Sólo Host)
  const handleWebViewMessage = (event) => {
    if (!isHost) return; // Sólo el host puede enviar comandos de reproducción

    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log("📥 Evento de Video Web recibido:", data);

      if (data.type === 'PLAY') {
        socket.emit('video-state-change', {
          roomId,
          state: 'PLAYING',
          currentTime: data.currentTime
        });
      } else if (data.type === 'PAUSE') {
        socket.emit('video-state-change', {
          roomId,
          state: 'PAUSED',
          currentTime: data.currentTime
        });
      } else if (data.type === 'SEEK') {
        socket.emit('video-state-change', {
          roomId,
          state: 'PLAYING', // o PAUSED
          currentTime: data.currentTime
        });
      }
    } catch (e) {
      console.warn("Error parseando mensaje de WebView:", e);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={() => {
        if (canGoBackRef.current && webViewRef.current) {
          webViewRef.current.goBack();
        } else {
          onClose();
        }
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

          {/* Campo de URL (En el Centro) */}
          <View className="flex-1 flex-row bg-dark-900 border border-white/5 rounded-xl px-3 py-2 items-center">
            <Globe className="w-4 h-4 text-white mr-2" color="#ffffff" />
            <TextInput
              value={inputUrl}
              onChangeText={setInputUrl}
              onSubmitEditing={handleNavigate}
              placeholder="Navegar por la web..."
              placeholderTextColor="#6b7280"
              className="flex-1 text-white text-xs py-0"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
            />
          </View>

          {/* Botón Añadir a Cola (para todos) */}
          {onAddToQueue && (
            <TouchableOpacity
              onPress={() => {
                const currentUrl = inputUrl;
                const title = currentUrl.replace(/^https?:\/\//, '').split('/')[0];
                onAddToQueue({ url: currentUrl, title });
                if (Platform.OS === 'android') {
                  ToastAndroid.show('Añadido a la cola ✓', ToastAndroid.SHORT);
                } else {
                  Alert.alert('Cola', 'Añadido a la cola de reproducción');
                }
              }}
              style={{ padding: 8, backgroundColor: '#6366f1', borderRadius: 12 }}
            >
              <PlusCircle size={20} color="#ffffff" />
            </TouchableOpacity>
          )}

          {/* Botón de Cerrar (A la Derecha) */}
          <TouchableOpacity 
            onPress={onClose}
            className="p-2 bg-dark-900 border border-white/5 rounded-xl"
          >
            <X className="w-5 h-5 text-white" color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* REPRODUCTOR WEB (WEBVIEW) */}
        <View className="flex-1 bg-black relative">
          <WebView
            ref={webViewRef}
            source={{ uri }}
            injectedJavaScriptBeforeContentLoaded={beforeContentScript}
            injectedJavaScript={combinedScript}
            injectedJavaScriptForMainFrameOnly={false}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
            onNavigationStateChange={(navState) => {
              setInputUrl(navState.url);
              setCanGoBack(navState.canGoBack);
              canGoBackRef.current = navState.canGoBack;
              setCanGoForward(navState.canGoForward);
              
              // Registrar última URL visitada
              const url = navState.url;
              if (url && !url.startsWith('about:')) {
                lastLegitimateUrlRef.current = url;
              }

              if (isHost && navState.url !== lastEmittedUrlRef.current) {
                lastEmittedUrlRef.current = navState.url;
                socket.emit('browser-navigation-change', { roomId, url: navState.url });
              }
            }}
            onShouldStartLoadWithRequest={(request) => {
              const url = request.url;
              console.log("🔍 [MiniBrowser Network] Petición de carga detectada:", url);

              // 1. Siempre permitir esquemas especiales o vacíos
              if (url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) {
                return true;
              }

              // 2. Si es una navegación manual iniciada por el usuario desde la barra de direcciones, permitirla siempre
              if (isManualNavigationRef.current) {
                isManualNavigationRef.current = false; // Resetear bandera
                return true;
              }

              // 3. Bloquear esquemas de intención nativos de publicidad (ej: intent://pyppo.com)
              if (!url.startsWith('http://') && !url.startsWith('https://')) {
                console.log("🚫 Yale: Esquema no HTTP bloqueado:", url);
                return false;
              }

              return true;
            }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => {
              setLoading(false);
            }}
            onMessage={handleWebViewMessage}
            allowsInlineMediaPlayback={true} // Importante para iOS
            mediaPlaybackRequiresUserAction={false} // Autoplay
            domStorageEnabled={true}
            javaScriptEnabled={true}
            mixedContentMode="always"
            incognito={true}
            cacheEnabled={false}
            cacheMode="LOAD_NO_CACHE"
            className="flex-1"
          />

          {/* Indicador de Carga */}
          {loading && (
            <View className="absolute top-0 left-0 right-0 h-1 bg-dark-900 justify-center">
              <ActivityIndicator size="small" color="#6366f1" />
            </View>
          )}

          {/* Bloqueo indicador de Sincronización para Invitados */}
          {!isHost && (
            <View className="absolute bottom-4 left-4 bg-indigo-600/90 border border-indigo-500/20 px-3 py-1.5 rounded-2xl flex-row items-center gap-1.5 shadow-2xl">
              <View className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              <Text className="text-[10px] font-black text-white uppercase tracking-wider">
                Navegador Sincronizado por el Host
              </Text>
            </View>
          )}
        </View>

      </SafeAreaView>
    </Modal>
  );
};

export default MiniBrowser;
