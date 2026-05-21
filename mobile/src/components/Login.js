import React, { useState } from 'react';
import { Text, View, TextInput, TouchableOpacity, Image, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { User, Rocket } from 'lucide-react-native';
import storage from '../utils/storage';

const AVATAR_SEEDS = ['Felix', 'Aneka', 'Midnight', 'Spooky', 'Cuddles', 'Casper', 'Snuggles', 'Oliver'];

const Login = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_SEEDS[0]);

  const handleSubmit = async () => {
    if (!username.trim()) return;

    // Usamos la versión PNG de Dicebear que es 100% compatible con la etiqueta nativa Image de Android/iOS
    const userData = {
      username: username.trim(),
      avatarUrl: `https://api.dicebear.com/7.x/bottts/png?seed=${selectedAvatar}`
    };

    // Guardar sesión de forma persistente en el dispositivo móvil
    await storage.setItem('yale_user', userData);
    onLoginSuccess(userData);
  };

  return (
    <SafeAreaView className="flex-1 bg-dark-900">
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1 justify-center px-6"
      >
      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
      >
        <View className="bg-dark-800 border border-white/5 rounded-[32px] p-6 shadow-2xl items-center">
          
          {/* Logo / Cabecera */}
          <View className="w-16 h-16 bg-indigo-600 rounded-2xl mb-4 items-center justify-center shadow-lg shadow-indigo-600/40">
            <Rocket className="text-white w-8 h-8" />
          </View>
          <Text className="text-3xl font-black tracking-tight text-white text-center">
            Bienvenido a Yale
          </Text>
          <Text className="text-gray-400 text-sm mt-1 mb-8 text-center">
            Configura tu perfil para empezar a ver videos
          </Text>

          {/* Campo de Nombre */}
          <View className="w-full mb-6">
            <Text className="text-xs font-semibold text-gray-400 mb-2 ml-1 uppercase tracking-wider">
              Tu nombre de usuario
            </Text>
            <View className="relative w-full">
              <View className="absolute left-4 top-[15px] z-10">
                <User className="text-gray-500 w-5 h-5" />
              </View>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Ej. JuanitoPlayer"
                placeholderTextColor="#6b7280"
                className="w-full bg-dark-900 border border-white/5 text-white rounded-2xl py-3.5 pl-12 pr-4 text-base focus:border-indigo-500"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          {/* Selección de Avatares */}
          <View className="w-full mb-8">
            <Text className="text-xs font-semibold text-gray-400 mb-3 ml-1 uppercase tracking-wider">
              Elige tu Avatar
            </Text>
            
            <View className="flex-row flex-wrap justify-between gap-y-3">
              {AVATAR_SEEDS.map((seed) => {
                const isSelected = selectedAvatar === seed;
                const avatarUri = `https://api.dicebear.com/7.x/bottts/png?seed=${seed}`;
                
                return (
                  <TouchableOpacity
                    key={seed}
                    activeOpacity={0.7}
                    onPress={() => setSelectedAvatar(seed)}
                    className="w-[22%]"
                  >
                    <View 
                      className={`aspect-square p-1 rounded-2xl border-2 justify-center items-center ${
                        isSelected ? 'border-indigo-500 bg-indigo-500/10' : 'border-transparent bg-dark-900'
                      }`}
                    >
                      <Image
                        source={{ uri: avatarUri }}
                        className="w-full h-full rounded-xl"
                        resizeMode="contain"
                      />
                      {isSelected && (
                        <View className="absolute -top-1 -right-1 bg-indigo-500 rounded-full w-5 h-5 items-center justify-center">
                          <Text className="text-white text-[9px] font-black">✓</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Botón de Entrada */}
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleSubmit}
            disabled={!username.trim()}
            className={`w-full py-4 rounded-2xl flex-row items-center justify-center gap-2 shadow-lg ${
              username.trim() ? 'bg-indigo-600 shadow-indigo-600/30' : 'bg-indigo-600/40 opacity-50'
            }`}
          >
            <Text className="text-white text-base font-black uppercase tracking-wider">
              Entrar a Yale
            </Text>
            <Rocket className="w-5 h-5 text-white" />
          </TouchableOpacity>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default Login;
