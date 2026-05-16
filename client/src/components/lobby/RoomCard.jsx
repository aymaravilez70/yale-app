import React from 'react';
import { Users, Play } from 'lucide-react';

const RoomCard = ({ room, onJoin }) => {
  const { video_actual, participantes, creador, privacidad } = room;

  return (
    <div 
      onClick={() => onJoin(room.sala_id)}
      className="group bg-dark-800 border border-dark-700 rounded-3xl overflow-hidden hover:border-indigo-500 transition-all cursor-pointer shadow-lg hover:shadow-indigo-500/10"
    >
      {/* Miniatura del Video */}
      <div className="aspect-video w-full relative overflow-hidden">
        <img 
          src={video_actual?.miniatura || 'https://via.placeholder.com/640x360?text=Cargando...'} 
          alt={video_actual?.titulo || 'Video'} 
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-dark-900 via-transparent to-transparent opacity-60"></div>
        
        {/* Badge de Privacidad */}
        <div className="absolute top-3 left-3 bg-indigo-600 text-[10px] font-black px-2 py-1 rounded-md uppercase tracking-widest shadow-lg">
          {privacidad}
        </div>

        {/* Overlay Play */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
          <div className="bg-white text-black p-4 rounded-full shadow-2xl transform scale-75 group-hover:scale-100 transition-transform">
            <Play className="w-6 h-6 fill-current" />
          </div>
        </div>
      </div>

      {/* Info de la Sala */}
      <div className="p-5">
        <h3 className="font-bold text-gray-100 line-clamp-1 mb-1 group-hover:text-indigo-400 transition-colors">
          {video_actual?.titulo || 'Video sin título'}
        </h3>
        <p className="text-xs text-gray-500 mb-4">Host: {creador}</p>

        <div className="flex items-center justify-between border-t border-dark-700 pt-4">
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {participantes?.slice(0, 3).map((p, i) => (
                <img 
                  key={p.socket_id || i} 
                  src={p.avatarUrl} 
                  className="w-6 h-6 rounded-full border-2 border-dark-800" 
                  alt="avatar"
                />
              ))}
            </div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
              {participantes?.length > 0 ? `${participantes.length} viendo ahora` : 'Sala vacía'}
            </span>
          </div>
          
          <div className="flex items-center gap-1 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
             <span className="text-[10px] font-black uppercase tracking-widest">Unirse</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoomCard;
