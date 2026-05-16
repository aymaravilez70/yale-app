import React, { useEffect, useState } from 'react';
import socket from '../../config/socket';
import { LogOut, MonitorPlay, Plus, Users, Signal, SignalHigh } from 'lucide-react';
import CreateRoomModal from './CreateRoomModal';
import RoomCard from './RoomCard';

const Lobby = ({ user, onLogout, onJoinRoom }) => {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [showModal, setShowModal] = useState(false);
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    const joinLobby = () => {
      if (socket.connected) {
        socket.emit('join-lobby');
      }
    };

    // Unirse inmediatamente si ya está conectado
    joinLobby();

    const handleConnect = () => {
      setIsConnected(true);
      joinLobby(); // Volver a unirse si se reconecta
    };

    const handleDisconnect = () => setIsConnected(false);
    
    const handleRoomsUpdate = (data) => {
      console.log("Salas actualizadas recibidas:", data);
      setRooms(data);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('lista-salas-actualizada', handleRoomsUpdate);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('lista-salas-actualizada', handleRoomsUpdate);
    };
  }, []);

  return (
    <div className="min-h-screen bg-dark-900 text-white">
      {/* NAVBAR */}
      <nav className="bg-dark-800 border-b border-dark-700 px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-xl">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-600/20">
            <MonitorPlay className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-black tracking-tighter">YALE</span>
        </div>

        <div className="flex items-center gap-6">
          {/* Status Socket */}
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all duration-500 ${
            isConnected ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-red-500/10 border-red-500/20 text-red-500'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
            {isConnected ? 'Servidor Online' : 'Servidor Offline'}
          </div>

          {/* User Profile & Logout */}
          <div className="flex items-center gap-4 bg-dark-900/50 p-1 pr-4 rounded-full border border-dark-700 hover:border-dark-600 transition-colors">
            <img src={user.avatarUrl} alt="Avatar" className="w-8 h-8 rounded-full border border-dark-600" />
            <div className="flex flex-col">
              <span className="text-sm font-bold leading-none">{user.username}</span>
              <span className="text-[9px] text-gray-500 uppercase font-black tracking-tighter">Mi Perfil</span>
            </div>
            <div className="w-px h-6 bg-dark-700 mx-1"></div>
            <button 
              onClick={onLogout}
              className="text-gray-500 hover:text-red-500 transition-colors"
              title="Cerrar Sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main className="max-w-7xl mx-auto p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-4">
          <div>
            <h2 className="text-4xl font-black mb-2 tracking-tight">Explorar Salas</h2>
            <p className="text-gray-400">Únete a una sala y empieza a ver videos con amigos.</p>
          </div>
          
          <button 
            onClick={() => setShowModal(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl font-black flex items-center gap-2 transition-all shadow-xl shadow-indigo-600/20 active:scale-95 uppercase tracking-widest text-xs"
          >
            <Plus className="w-5 h-5" />
            Crear Sala
          </button>
        </div>

        {/* Modal para crear sala */}
        {showModal && (
          <CreateRoomModal 
            user={user} 
            onClose={() => setShowModal(false)} 
            onCreateSuccess={(roomId) => {
              setShowModal(false);
              onJoinRoom(roomId);
            }}
          />
        )}

        {/* GRID DE SALAS */}
        {rooms.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 animate-in fade-in duration-700">
            {rooms.map((room) => (
              <RoomCard 
                key={room.sala_id} 
                room={room} 
                onJoin={onJoinRoom} 
              />
            ))}
          </div>
        ) : (
          <div className="py-32 flex flex-col items-center justify-center border-2 border-dashed border-dark-700 rounded-[3rem] bg-dark-800/20">
            <div className="bg-dark-800 p-6 rounded-full mb-6 border border-dark-700 shadow-xl">
              <Users className="w-12 h-12 text-dark-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-400">No hay salas activas ahora mismo</h3>
            <p className="text-sm text-gray-600 mt-2">¡Sé el primero en crear una y empieza la fiesta!</p>
            <button 
              onClick={() => setShowModal(true)}
              className="mt-8 text-indigo-500 hover:text-indigo-400 font-bold underline transition-colors"
            >
              Crear mi primera sala
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default Lobby;
