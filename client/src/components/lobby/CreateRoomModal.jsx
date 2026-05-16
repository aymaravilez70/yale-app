import React, { useState } from 'react';
import { Search, X, Loader2, Play } from 'lucide-react';
import socket from '../../config/socket';

const CreateRoomModal = ({ user, onClose, onCreateSuccess }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const response = await fetch(`http://localhost:4000/api/youtube/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      setResults(data);
    } catch (error) {
      console.error("Error buscando videos:", error);
    } finally {
      setLoading(false);
    }
  };

  const selectVideo = (video) => {
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

    // Emitir creación al servidor
    socket.emit('crear-sala', nuevaSala);
    
    // Notificar al componente padre para redirección
    onCreateSuccess(roomId);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-dark-800 w-full max-w-2xl rounded-3xl border border-dark-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-6 border-b border-dark-700 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black">Crear Nueva Sala</h2>
            <p className="text-gray-400 text-sm">Busca un video de YouTube para empezar</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-dark-700 rounded-full transition-colors text-gray-400">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-6">
          <form onSubmit={handleSearch} className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Escribe el nombre de un video o canción..."
              className="w-full bg-dark-900 border border-dark-700 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-all shadow-inner"
            />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
            <button 
              type="submit" 
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-lg shadow-indigo-600/20"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Buscar"}
            </button>
          </form>
        </div>

        {/* Results Container */}
        <div className="flex-1 overflow-y-auto p-6 pt-0 space-y-4">
          {loading && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 opacity-50">
              <Loader2 className="w-10 h-10 animate-spin text-indigo-500 mb-2" />
              <p>Buscando en YouTube...</p>
            </div>
          )}

          {!loading && results.length === 0 && query && (
            <div className="text-center py-20 opacity-50">
              <p>No se encontraron resultados.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {results.map((video) => (
              <button
                key={video.id}
                onClick={() => selectVideo(video)}
                className="group relative flex flex-col bg-dark-900 border border-dark-700 rounded-2xl overflow-hidden hover:border-indigo-500 transition-all text-left"
              >
                <div className="aspect-video w-full relative">
                  <img src={video.miniatura} alt={video.titulo} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="bg-white text-black p-3 rounded-full shadow-xl transform translate-y-4 group-hover:translate-y-0 transition-transform">
                      <Play className="w-6 h-6 fill-current" />
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-bold line-clamp-2 text-gray-200 leading-tight group-hover:text-white transition-colors">
                    {video.titulo}
                  </h3>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-dark-900/50 text-center text-[10px] text-gray-500 uppercase tracking-widest border-t border-dark-700">
          Powered by YouTube Data API v3
        </div>
      </div>
    </div>
  );
};

export default CreateRoomModal;
