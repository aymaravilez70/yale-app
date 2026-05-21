import React, { useEffect, useState } from 'react';
import { Text, View, TouchableOpacity, Image, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogOut, MonitorPlay, Plus, Users } from 'lucide-react-native';
import socket from '../../config/socket';
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

    // Unirse inmediatamente si el socket ya está conectado
    joinLobby();

    const handleConnect = () => {
      setIsConnected(true);
      joinLobby(); // Volver a unirse al reconectarse
    };

    const handleDisconnect = () => setIsConnected(false);
    
    const handleRoomsUpdate = (data) => {
      console.log("📱 Salas móviles actualizadas recibidas:", data);
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
    <SafeAreaView className="flex-1 bg-dark-900">
      
      {/* NAVBAR SUPERIOR */}
      <View className="bg-dark-800 border-b border-white/5 px-6 py-4 flex-row items-center justify-between shadow-2xl">
        <View className="flex-row items-center gap-2">
          <View className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-600/30">
            <MonitorPlay className="w-5 h-5 text-white" />
          </View>
          <Text className="text-xl font-black tracking-tighter text-white">YALE</Text>
        </View>

        {/* Perfil & Logout */}
        <View className="flex-row items-center bg-dark-900 border border-white/5 p-1 pr-3 rounded-full">
          <Image 
            source={{ uri: user.avatarUrl }} 
            className="w-7 h-7 rounded-full border border-white/10" 
          />
          <Text className="text-xs text-white font-bold ml-2 mr-3">{user.username}</Text>
          <TouchableOpacity 
            onPress={onLogout}
            className="p-1"
            activeOpacity={0.7}
          >
            <LogOut className="w-4 h-4 text-gray-500 hover:text-red-500" />
          </TouchableOpacity>
        </View>
      </View>

      {/* CONTENIDO PRINCIPAL */}
      <ScrollView 
        className="flex-grow px-6 pt-6"
        showsVerticalScrollIndicator={false}
      >
        {/* Cabecera & Botón de Crear */}
        <View className="mb-6 flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-black text-white">Salas Activas</Text>
            
            {/* Status del Servidor */}
            <View className="flex-row items-center mt-1">
              <View className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              <Text className={`text-[9px] font-black uppercase tracking-wider ${isConnected ? 'text-green-500' : 'text-red-500'}`}>
                {isConnected ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setShowModal(true)}
            className="bg-indigo-600 py-3 px-5 rounded-2xl flex-row items-center gap-1.5 shadow-lg shadow-indigo-600/30"
          >
            <Plus className="w-4 h-4 text-white" />
            <Text className="text-white font-black text-xs uppercase tracking-widest">Crear Sala</Text>
          </TouchableOpacity>
        </View>

        {/* LISTADO DE SALAS */}
        {rooms.length > 0 ? (
          <View className="pb-16">
            {rooms.map((room) => (
              <RoomCard 
                key={room.sala_id} 
                room={room} 
                onJoin={onJoinRoom} 
              />
            ))}
          </View>
        ) : (
          /* Fallback vació */
          <View className="my-16 items-center justify-center border border-dashed border-white/10 rounded-[32px] bg-dark-800/10 p-8">
            <View className="bg-dark-800 p-5 rounded-full mb-4 border border-white/5 shadow-xl">
              <Users className="w-10 h-10 text-gray-600" />
            </View>
            <Text className="text-base font-bold text-gray-400 text-center">No hay salas activas ahora mismo</Text>
            <Text className="text-xs text-gray-600 text-center mt-1">¡Sé el primero en crear una y empieza la fiesta!</Text>
            
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={() => setShowModal(true)}
              className="mt-6"
            >
              <Text className="text-indigo-500 font-bold underline">Crear mi primera sala</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Modal para crear sala */}
      <CreateRoomModal 
        visible={showModal}
        user={user} 
        onClose={() => setShowModal(false)} 
        onCreateSuccess={(roomId) => {
          setShowModal(false);
          onJoinRoom(roomId);
        }}
      />

    </SafeAreaView>
  );
};

export default Lobby;
