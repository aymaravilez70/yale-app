import React from 'react';
import { Text, View, TouchableOpacity, Image } from 'react-native';
import { Play } from 'lucide-react-native';

const RoomCard = ({ room, onJoin }) => {
  const { video_actual, participantes = [], creador, privacidad, sala_id } = room;

  return (
    <TouchableOpacity 
      activeOpacity={0.9}
      onPress={() => onJoin(sala_id)}
      className="bg-dark-800 border border-white/5 rounded-3xl overflow-hidden mb-6 shadow-xl"
    >
      
      {/* Miniatura del Video */}
      <View className="aspect-video w-full relative overflow-hidden">
        <Image 
          source={{ uri: video_actual?.miniatura || 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=640' }}
          className="w-full h-full"
          resizeMode="cover"
        />
        <View className="absolute inset-0 bg-black/20" />

        {/* Badge de Privacidad */}
        <View className="absolute top-3 left-3 bg-indigo-600 px-2.5 py-1 rounded-lg">
          <Text className="text-white text-[8px] font-black uppercase tracking-widest">
            {privacidad}
          </Text>
        </View>

        {/* Overlay Play Icon */}
        <View className="absolute inset-0 items-center justify-center">
          <View className="bg-white/90 p-3 rounded-full shadow-2xl">
            <Play className="text-black w-5 h-5 fill-current ml-0.5" />
          </View>
        </View>
      </View>

      {/* Info de la Sala */}
      <View className="p-5">
        <Text 
          numberOfLines={1} 
          className="font-black text-gray-100 text-base mb-1"
        >
          {video_actual?.titulo || 'Video sin título'}
        </Text>
        <Text className="text-xs text-gray-500 mb-4">
          Host: <Text className="text-indigo-400 font-bold">{creador}</Text>
        </Text>

        {/* Participantes & CTA */}
        <View className="flex-row items-center justify-between border-t border-white/5 pt-4">
          
          {/* Overlapping Avatars */}
          <View className="flex-row items-center">
            <View className="flex-row mr-2">
              {participantes?.slice(0, 3).map((p, i) => (
                <View 
                  key={p.socket_id || i} 
                  className="w-6 h-6 rounded-full border border-dark-800 -mr-2 bg-dark-900 overflow-hidden"
                >
                  <Image 
                    source={{ uri: p.avatarUrl }} 
                    className="w-full h-full"
                  />
                </View>
              ))}
            </View>
            <Text className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">
              {participantes?.length > 0 ? `${participantes.length} viendo` : 'Sala vacía'}
            </Text>
          </View>

          {/* CTA Button */}
          <View className="bg-indigo-600/10 border border-indigo-500/20 px-3.5 py-1.5 rounded-xl">
            <Text className="text-indigo-400 text-[10px] font-black uppercase tracking-widest">
              Unirse
            </Text>
          </View>

        </View>
      </View>

    </TouchableOpacity>
  );
};

export default RoomCard;
