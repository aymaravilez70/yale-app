import React, { useEffect, useState, useRef } from 'react';
import YouTube from 'react-youtube';
import socket from '../../config/socket';
import { API_BASE_URL } from '../../config/config';
import { Send, ChevronLeft, Users, MessageSquare, Lock, Loader2, Volume2, Smile, Search, X } from 'lucide-react';

const Room = ({ roomId, user, onLeave }) => {
  const [roomData, setRoomData] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [volume, setVolume] = useState(50);
  const [playerReady, setPlayerReady] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [reactions, setReactions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [activeReactionMenuId, setActiveReactionMenuId] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  
  const playerRef = useRef(null);
  const isInternalChange = useRef(false);
  const hasStarted = useRef(false);
  const chatContainerRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // (El useEffect del volumen fue eliminado para evitar el crasheo de la API de YouTube)

  // 2. Gestión de conexión y eventos
  useEffect(() => {
    if (!roomId || !user) return;

    socket.emit('join-room', { roomId, user });

    const handleRoomState = (data) => {
      setRoomData(data);
      setParticipants(data.participantes || []);
      setShowSuggestions(false);
    };

    const handleNewParticipant = (list) => setParticipants(list || []);
    const handleMessage = (msg) => setMessages((prev) => [...prev, msg]);
    
    const handleVideoUpdate = ({ state, currentTime }) => {
      // Actualizar el estado local para que el "Vigilante" sepa el estado real
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

      // playerReady no se usa aquí porque causa un closure "stale". Si playerRef.current existe, está listo.
      if (playerRef.current && !isInternalChange.current) {
        try {
          if (!playerRef.current.getIframe()) return;
          isInternalChange.current = true;
          const player = playerRef.current;
          const localTime = player.getCurrentTime();
          
          if (Math.abs(localTime - currentTime) > 2) player.seekTo(currentTime);
          if (state === 'PLAYING') player.playVideo();
          else if (state === 'PAUSED') player.pauseVideo();
          
          setTimeout(() => { isInternalChange.current = false; }, 800);
        } catch (e) { console.warn("Ignored player error:", e); }
      }
    };

    socket.on('room-state', handleRoomState);
    socket.on('nuevo-participante', handleNewParticipant);
    socket.on('participante-salio', handleNewParticipant);
    socket.on('video-state-update', handleVideoUpdate);
    socket.on('receive-message', handleMessage);
    socket.on('receive-reaction', (type) => triggerReaction(type));
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

    return () => {
      socket.emit('leave-room');
      socket.off('room-state');
      socket.off('nuevo-participante');
      socket.off('participante-salio');
      socket.off('video-state-update');
      socket.off('receive-message');
      socket.off('receive-reaction');
      socket.off('receive-message-reaction');
      socket.off('user-typing', handleTyping);
      socket.off('user-stop-typing', handleStopTyping);
    };
  }, [roomId]);

  // 3. Vigilante de Sincronización (Solo para invitados)
  useEffect(() => {
    const syncInterval = setInterval(() => {
      if (playerRef.current && playerReady && roomData && !isInternalChange.current) {
        const isHost = user?.username === roomData?.creador;
        if (!isHost) {
          let serverTime = roomData.video_actual?.currentTime || 0;
          if (roomData.video_actual?.state === 'PLAYING' && roomData.video_actual?.lastUpdate) {
            serverTime += (Date.now() - roomData.video_actual.lastUpdate) / 1000;
          }
          try {
            if (!playerRef.current.getIframe()) return;
            const localTime = playerRef.current.getCurrentTime();
            if (Math.abs(localTime - serverTime) > 3) {
              isInternalChange.current = true;
              playerRef.current.seekTo(serverTime);
              setTimeout(() => { isInternalChange.current = false; }, 800);
            }
          } catch (e) { console.warn("Sync error:", e); }
        }
      }
    }, 2000);
    return () => clearInterval(syncInterval);
  }, [roomData, playerReady, user?.username]);

  // 3. Scroll Automático al final del chat (Seguro)
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages]);

  const onPlayerReady = (event) => {
    playerRef.current = event.target;
    setPlayerReady(true);

    // ARRANQUE MAESTRO (integrado para resistir remounts de YouTube API)
    try {
      if (roomData?.video_actual && event.target.getIframe()) {
        isInternalChange.current = true;
        let serverTime = roomData.video_actual.currentTime || 0;
        if (roomData.video_actual.state === 'PLAYING' && roomData.video_actual.lastUpdate) {
          serverTime += (Date.now() - roomData.video_actual.lastUpdate) / 1000;
        }
        event.target.seekTo(serverTime);
        if (roomData.video_actual.state === 'PLAYING') {
          event.target.playVideo();
        } else {
          event.target.pauseVideo();
        }
        setTimeout(() => { isInternalChange.current = false; }, 1000);
      }
    } catch (e) { console.warn("Error en arranque maestro:", e); }

    // Establecer volumen de forma segura con un pequeño retraso
    setTimeout(() => {
      try {
        if (event.target.getIframe()) {
          event.target.setVolume(volume);
        }
      } catch (e) { console.warn("Volumen diferido", e); }
    }, 1500);
  };

  const handleVolumeChange = (e) => {
    const newVol = parseInt(e.target.value);
    setVolume(newVol);
    if (playerRef.current && playerReady) {
      try {
        if (playerRef.current.getIframe()) {
          playerRef.current.setVolume(newVol);
        }
      } catch (err) { console.warn("Volume error:", err); }
    }
  };

  const onPlayerStateChange = (event) => {
    if (event.data === 1) setShowSuggestions(false);
    if (event.data === 0) {
      setShowSuggestions(true);
      const title = event.target.getVideoData().title || 'music';
      fetch(`${API_BASE_URL}/api/youtube/recommendations?q=${encodeURIComponent(title)}`)
        .then(res => res.json())
        .then(data => setSuggestions(data))
        .catch(e => console.warn(e));
    }

    if (isInternalChange.current || !roomData) return;
    const isHost = user?.username === roomData?.creador;
    
    if (!isHost) {
      try {
        if (!playerRef.current || !playerRef.current.getIframe()) return;
        isInternalChange.current = true;
        if (roomData?.video_actual?.state === 'PLAYING') playerRef.current.playVideo();
        else playerRef.current.pauseVideo();
        setTimeout(() => { isInternalChange.current = false; }, 500);
      } catch (e) { console.warn("Ignored player error:", e); }
      return;
    }

    const state = event.data === 1 ? 'PLAYING' : (event.data === 2 || event.data === 0) ? 'PAUSED' : null;
    if (state) {
      socket.emit('video-state-change', {
        roomId,
        state,
        currentTime: event.target.getCurrentTime()
      });
    }
  };

  const handleManualSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/youtube/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();
      setSuggestions(data);
    } catch (error) {
      console.error("Error buscando:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
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
  };

  const handleAddMessageReaction = (messageId, emoji) => {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: [...(m.reactions || []), emoji] } : m));
    socket.emit('message-reaction', { roomId, messageId, emoji });
    setActiveReactionMenuId(null);
  };

  const triggerReaction = (type) => {
    const id = Date.now() + Math.random().toString();
    const left = Math.floor(Math.random() * 80) + 10;
    setReactions(prev => [...prev, { id, type, left }]);
    setTimeout(() => {
      setReactions(prev => prev.filter(r => r.id !== id));
    }, 2000);
  };

  const handleReactionClick = (type) => {
    triggerReaction(type);
    socket.emit('send-reaction', { roomId, reactionType: type });
  };

  const handleSelectVideo = (video) => {
    if (user?.username !== roomData?.creador) return;
    setShowSuggestions(false);
    socket.emit('change-video', { roomId, video });
  };

  if (!roomData) {
    return (
      <div className="h-screen bg-dark-900 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
        <p className="text-gray-400 animate-pulse font-bold tracking-widest uppercase text-xs">Conectando a Yale...</p>
      </div>
    );
  }

  const isHost = user?.username === roomData?.creador;

  return (
    <div className="flex-1 flex flex-col md:flex-row w-full h-full bg-dark-900 text-white overflow-hidden">
      
      {/* Columna: Video (Arriba en móvil, Izquierda en desktop) */}
      <div className="w-full md:flex-1 flex flex-col p-0 md:p-6 overflow-hidden bg-black md:bg-transparent">
        
        {/* Header compacto para móvil / Header normal para desktop */}
        <div className="flex items-center justify-between p-4 md:p-0 md:mb-4 shrink-0 bg-dark-900/50 md:bg-transparent backdrop-blur-md md:backdrop-blur-none border-b border-white/5 md:border-none">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowExitConfirm(true)} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors group">
              <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              <span className="font-bold hidden sm:inline text-sm">Lobby</span>
            </button>
            <button 
              onClick={() => {
                setShowSuggestions(!showSuggestions);
                if (!showSuggestions && suggestions.length === 0) {
                   const title = roomData?.video_actual?.titulo || 'music';
                   fetch(`${API_BASE_URL}/api/youtube/recommendations?q=${encodeURIComponent(title)}`)
                    .then(res => res.json())
                    .then(data => setSuggestions(data));
                }
              }} 
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all font-bold text-xs uppercase tracking-widest ${showSuggestions ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            >
              <Search className="w-4 h-4" />
              <span className="hidden lg:inline">Buscar Música</span>
            </button>
          </div>
          
          <div className="flex flex-col items-end text-right">
            <h1 className="text-sm md:text-lg font-black tracking-tight line-clamp-1 max-w-[150px] sm:max-w-xs md:max-w-xl">
              {roomData?.video_actual?.titulo || 'Cargando título...'}
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-[8px] md:text-[9px] font-black bg-red-600 px-1.5 py-0.5 rounded text-white uppercase">En Vivo</span>
              <span className="text-[9px] md:text-[10px] text-gray-500 font-bold">Host: <span className="text-indigo-400">{roomData?.creador || 'Desconocido'}</span></span>
            </div>
          </div>
        </div>

        {/* Contenedor del Reproductor */}
        <div className="relative aspect-video md:flex-1 md:rounded-3xl overflow-hidden bg-black shadow-2xl md:border border-white/5 group">
          {roomData?.video_actual?.id && (
            <YouTube
              videoId={roomData.video_actual.id}
              opts={{
                width: '100%', height: '100%',
                playerVars: { autoplay: 1, controls: isHost ? 1 : 0, modestbranding: 1, rel: 0, showinfo: 0, iv_load_policy: 3, disablekb: isHost ? 0 : 1 }
              }}
              onReady={onPlayerReady}
              onStateChange={onPlayerStateChange}
              className="absolute inset-0 w-full h-full"
            />
          )}
          
          <div className="absolute bottom-6 left-6 flex items-center gap-3 bg-dark-900/80 backdrop-blur-md p-2.5 px-3 rounded-2xl border border-white/10 group/volume transition-all hover:w-48 w-12 overflow-hidden shadow-2xl z-30 opacity-0 group-hover:opacity-100 duration-300">
            <Volume2 className="w-5 h-5 text-indigo-400 shrink-0" />
            <input type="range" min="0" max="100" value={volume} onChange={handleVolumeChange} className="w-32 h-1 bg-dark-700 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
          </div>

          <div className="absolute top-0 right-0 w-48 h-24 bg-gradient-to-bl from-dark-900/90 via-dark-900/40 to-transparent z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <div className="absolute top-5 right-5 flex items-center gap-2 bg-indigo-600/20 backdrop-blur-xl px-3.5 py-2 rounded-2xl border border-indigo-500/30 z-30 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 shadow-2xl">
            <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse"></div>
            <span className="text-[9px] font-black uppercase tracking-widest text-indigo-100">Yale Room: {roomId.slice(-4)}</span>
          </div>

          {/* OVERLAY DE REACCIONES */}
          <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
            {reactions.map(r => (
              <div 
                key={r.id} 
                className="absolute bottom-10 reaction-emoji text-3xl drop-shadow-lg"
                style={{ left: `${r.left}%` }}
              >
                {r.type === 'heart' ? '❤️' : r.type === 'laugh' ? '😂' : r.type === 'fire' ? '🔥' : '😮'}
              </div>
            ))}
          </div>

          {/* BOTONES DE REACCIONES */}
          <div className="absolute bottom-6 right-6 flex items-center gap-1.5 bg-dark-900/80 backdrop-blur-md px-3 py-2 rounded-2xl border border-white/10 shadow-2xl z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
             <button onClick={() => handleReactionClick('heart')} className="hover:scale-125 hover:-translate-y-2 transition-all duration-200 text-xl grayscale-[0.2] hover:grayscale-0 drop-shadow-md">❤️</button>
             <button onClick={() => handleReactionClick('laugh')} className="hover:scale-125 hover:-translate-y-2 transition-all duration-200 text-xl grayscale-[0.2] hover:grayscale-0 drop-shadow-md">😂</button>
             <button onClick={() => handleReactionClick('fire')} className="hover:scale-125 hover:-translate-y-2 transition-all duration-200 text-xl grayscale-[0.2] hover:grayscale-0 drop-shadow-md">🔥</button>
             <button onClick={() => handleReactionClick('wow')} className="hover:scale-125 hover:-translate-y-2 transition-all duration-200 text-xl grayscale-[0.2] hover:grayscale-0 drop-shadow-md">😮</button>
          </div>

          {!isHost && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none">
              <div className="absolute inset-0 z-0 pointer-events-auto cursor-default"></div>
              <div className="absolute top-4 left-4 flex items-center gap-2 bg-dark-900/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 z-20">
                <Lock className="w-3 h-3 text-yellow-500" />
                <span className="text-[9px] font-black uppercase opacity-70">Sincronizado</span>
              </div>
            </div>
          )}

          {/* OVERLAY WALL OF MUSIC */}
          {showSuggestions && (
            <div className="absolute inset-0 bg-dark-900/95 backdrop-blur-md z-40 p-6 overflow-y-auto flex flex-col custom-scrollbar animate-in fade-in zoom-in-95 duration-200">
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 sticky top-0 bg-dark-900/90 py-4 z-10 border-b border-white/10 gap-4">
                <div>
                  <h2 className="text-xl font-black uppercase tracking-wider text-indigo-400">
                    {isHost ? "Cambiar la música" : "Siguientes sugerencias"}
                  </h2>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">Busca cualquier video de YouTube</p>
                </div>

                {isHost && (
                  <form onSubmit={handleManualSearch} className="flex-1 max-w-md relative group">
                    <input 
                      type="text" 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Busca una canción..." 
                      className="w-full bg-dark-800 border border-white/10 rounded-2xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-all shadow-inner"
                    />
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-indigo-400 transition-colors" />
                    {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-indigo-400" />}
                  </form>
                )}

                <button 
                  onClick={() => setShowSuggestions(false)}
                  className="bg-white/5 hover:bg-white/10 p-2.5 rounded-2xl transition-all border border-white/5"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pb-10">
                {(isSearching || suggestions.length === 0) ? (
                   <div className="col-span-full flex flex-col items-center justify-center py-20 opacity-50">
                      <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mb-4" />
                      <p className="text-xs font-black uppercase tracking-widest">{isSearching ? "Buscando..." : "Cargando sugerencias..."}</p>
                   </div>
                ) : (
                  suggestions.map((vid) => (
                    <div 
                      key={vid.id}
                      onClick={() => handleSelectVideo(vid)}
                      className={`relative aspect-video rounded-xl overflow-hidden group/card cursor-pointer border-2 border-transparent transition-all duration-300 ${isHost ? 'hover:scale-105 hover:border-indigo-500 hover:shadow-lg hover:shadow-indigo-500/20' : 'opacity-80'}`}
                    >
                      <img src={vid.miniatura} alt={vid.titulo} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent"></div>
                      <div className="absolute bottom-2 left-2 right-2">
                        <p className="text-xs font-bold text-white line-clamp-2 leading-tight drop-shadow-md">{vid.titulo}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {!isHost && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                  <div className="bg-dark-800/90 px-6 py-4 rounded-3xl border border-white/10 shadow-2xl flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                    <p className="text-sm font-bold text-gray-200">Esperando que el Host elija el siguiente tema...</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Columna: Sidebar / Chat (Abajo en móvil, Derecha en desktop) */}
      <div className="flex-1 md:w-80 lg:w-96 bg-dark-800 md:border-l border-dark-700 flex flex-col overflow-hidden shadow-2xl min-h-0">
        
        {/* Participantes (Solo visible en Desktop o colapsable) */}
        <div className="hidden md:block p-4 border-b border-dark-700">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-black uppercase tracking-widest">Gente</h3>
            </div>
            <span className="bg-dark-900 px-2 py-0.5 rounded text-[10px] font-bold text-gray-400">{participants.length}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {participants?.map((p, i) => (
              <div key={p?.socket_id || i} className="relative">
                <img src={p?.avatarUrl} title={p?.username} className={`w-10 h-10 rounded-full border-2 transition-all ${p?.username === roomData?.creador ? 'border-yellow-500 scale-110 shadow-lg' : 'border-dark-600'}`} alt={p?.username || 'user'} />
                {p?.username === roomData?.creador && (
                   <div className="absolute -top-1 -right-1 bg-yellow-500 text-black rounded-full p-0.5 shadow-xl">
                      <Lock className="w-2 h-2" fill="currentColor" />
                   </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col h-full overflow-hidden relative">
          {/* Fondo difuminado estilo Rave para el chat en móvil */}
          <div className="absolute inset-0 z-0 opacity-10 pointer-events-none">
             <img src={roomData?.video_actual?.miniatura} className="w-full h-full object-cover blur-3xl scale-150" alt="" />
          </div>

          <div className="p-3 md:p-4 border-b border-dark-700 flex items-center justify-between bg-dark-800/80 backdrop-blur-md z-10 shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-indigo-400" />
              <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest">Chat en Vivo</h3>
            </div>
            <div className="md:hidden flex items-center gap-1.5">
               <Users className="w-3 h-3 text-gray-500" />
               <span className="text-[10px] font-bold text-gray-500">{participants.length}</span>
            </div>
          </div>

          <div ref={chatContainerRef} className="flex-1 overflow-y-auto min-h-0 p-3 md:p-4 space-y-4 custom-scrollbar z-10">
            {(!messages || messages.length === 0) && (
              <div className="text-center py-10 opacity-20">
                <MessageSquare className="w-12 h-12 mx-auto mb-2" />
                <p className="text-xs font-bold uppercase tracking-tighter text-center">Sin mensajes</p>
              </div>
            )}
            {messages?.map((msg, i) => {
              if (msg.isSystem) {
                return (
                  <div key={msg.id || i} className="flex justify-center my-2 animate-in fade-in duration-300">
                    <span className="bg-dark-700/50 border border-white/5 text-gray-400 text-[9px] px-4 py-1.5 rounded-full font-bold uppercase tracking-wider text-center shadow-inner">
                      {msg.text}
                    </span>
                  </div>
                );
              }

              const isMe = msg?.username === user?.username;
              return (
                <div key={msg.id || i} className={`flex gap-3 animate-in slide-in-from-bottom-2 group/msg ${isMe ? 'flex-row-reverse' : ''}`}>
                  <img src={msg?.avatarUrl} className="w-7 h-7 md:w-8 md:h-8 rounded-full border border-dark-600 self-start mt-1 shrink-0" alt="avatar" />
                  <div className={`flex flex-col min-w-0 max-w-[85%] relative ${isMe ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-baseline gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                      <span className="text-[10px] md:text-[11px] font-black text-indigo-400 truncate">{isMe ? 'Tú' : msg?.username}</span>
                      <span className="text-[8px] md:text-[9px] text-gray-500 font-bold shrink-0">{msg?.timestamp}</span>
                    </div>
                    
                    <div className="relative group">
                      <div className={`p-2.5 mt-1 border border-white/5 text-sm break-words shadow-md transition-all ${
                        isMe 
                          ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-none' 
                          : 'bg-dark-900/80 text-gray-100 rounded-2xl rounded-tl-none'
                      }`}>
                        {msg?.text}
                      </div>

                      {/* Botón de Reacción */}
                      <button 
                        onClick={() => setActiveReactionMenuId(activeReactionMenuId === msg.id ? null : msg.id)}
                        className={`absolute top-1/2 -translate-y-1/2 p-1.5 bg-dark-700 rounded-full border border-white/10 shadow-xl opacity-0 group-hover/msg:opacity-100 hover:scale-110 transition-all z-10 ${isMe ? '-left-8' : '-right-8'}`}
                      >
                        <Smile className="w-3.5 h-3.5 text-gray-400 hover:text-indigo-400" />
                      </button>

                      {/* Menú de Emojis */}
                      {activeReactionMenuId === msg.id && (
                        <div className={`absolute -top-10 flex gap-2 bg-dark-800 border border-dark-600 p-1.5 rounded-full shadow-2xl z-20 animate-in zoom-in-75 duration-150 ${isMe ? 'right-0' : 'left-0'}`}>
                          {['❤️', '😂', '🔥', '👍'].map(emoji => (
                            <button 
                              key={emoji}
                              onClick={() => handleAddMessageReaction(msg.id, emoji)}
                              className="hover:scale-150 transition-transform px-1"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Reacciones */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        {Array.from(new Set(msg.reactions)).map((emoji, idx) => (
                          <div key={idx} className="bg-dark-900/80 border border-white/5 px-1.5 py-0.5 rounded-full text-[10px] flex items-center gap-1 shadow-sm">
                            <span>{emoji}</span>
                            <span className="text-[8px] font-bold opacity-60">
                              {msg.reactions.filter(e => e === emoji).length}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            
            {typingUsers.length > 0 && (
              <div className="flex items-center gap-2 text-gray-500 animate-in slide-in-from-bottom-2 px-2 py-1">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <span className="text-[10px] font-bold italic">
                  {typingUsers.join(', ')} {typingUsers.length === 1 ? 'está' : 'están'} escribiendo...
                </span>
              </div>
            )}
          </div>

          <form onSubmit={handleSendMessage} className="p-3 md:p-4 bg-dark-900/80 md:bg-dark-900/50 backdrop-blur-xl border-t border-dark-700 z-20 shrink-0">
            <div className="relative">
              <input 
                type="text" 
                value={newMessage} 
                onChange={(e) => {
                  setNewMessage(e.target.value);
                  socket.emit('typing', { roomId, username: user?.username });
                  if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                  typingTimeoutRef.current = setTimeout(() => {
                    socket.emit('stop-typing', { roomId, username: user?.username });
                  }, 1500);
                }} 
                placeholder="Escribe algo..." 
                className="w-full bg-dark-900 border border-dark-700 rounded-2xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 shadow-inner"
                enterKeyHint="send"
                autoComplete="off"
              />
              <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-indigo-500 hover:scale-110 transition-transform"><Send className="w-5 h-5" /></button>
            </div>
          </form>
        </div>
      </div>

      {/* Modal de Confirmación de Salida */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-dark-800 border border-dark-700 p-6 rounded-3xl shadow-2xl max-w-sm w-full animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-black mb-2 text-white">¿Salir de la sala?</h3>
            <p className="text-gray-400 text-sm mb-6">
              {isHost ? 'Si sales, el siguiente participante será el nuevo líder de la sala.' : 'Estás a punto de volver al lobby.'}
            </p>
            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setShowExitConfirm(false)}
                className="px-4 py-2 rounded-xl text-sm font-bold text-gray-400 hover:text-white hover:bg-dark-700 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={onLeave}
                className="px-4 py-2 rounded-xl text-sm font-black bg-red-600/20 text-red-500 hover:bg-red-600 hover:text-white transition-colors border border-red-500/20"
              >
                Sí, salir
              </button>
            </div>
          </div>
        </div>
      )}
      
      <style>{`
        html, body, #root { 
          height: 100%;
          width: 100%;
          margin: 0;
          overflow: hidden; 
          overscroll-behavior: none;
        }
        @keyframes floatUp {
          0% { transform: translateY(0) scale(0.5) translateX(0); opacity: 0; }
          15% { transform: translateY(-20px) scale(1.2) translateX(5px); opacity: 1; }
          50% { transform: translateY(-100px) scale(1) translateX(-15px); opacity: 0.8; }
          100% { transform: translateY(-250px) scale(1) translateX(15px); opacity: 0; }
        }
        .reaction-emoji {
          animation: floatUp 2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.3); border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default Room;
