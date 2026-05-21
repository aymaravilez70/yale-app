import './global.css';
import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import storage from './src/utils/storage';
import Login from './src/components/Login';
import Lobby from './src/components/lobby/Lobby';
import Room from './src/components/room/Room';

// Configurar el manejador global de notificaciones (afuera del componente)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeRoomId, setActiveRoomId] = useState(null);

  // 🔔 CONFIGURACIÓN NATIVA DE NOTIFICACIONES Y PERMISOS
  useEffect(() => {
    const registerForNotifications = async () => {
      if (Platform.OS === 'android') {
        // Configurar el canal obligatorio para Android con máxima importancia
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#6366f1',
        });
      }

      // Comprobar si ya se otorgaron los permisos nativos
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      // Si no hay permisos, disparar la alerta del sistema operativo
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('🚫 El usuario rechazó los permisos de notificación');
        return;
      }

      // Obtener el token del dispositivo para el entorno nativo
      try {
        const tokenData = await Notifications.getExpoPushTokenAsync();
        console.log('🎫 Token de notificación nativa listo:', tokenData.data);
      } catch (error) {
        console.log('Error obteniendo el token:', error.message);
      }
    };

    registerForNotifications();

    // Listener para capturar alertas mientras el usuario está navegando en la app
    const notificationListener = Notifications.addNotificationReceivedListener(notification => {
      console.log('🔔 Notificación recibida en vivo:', notification);
    });

    return () => {
      Notifications.removeNotificationSubscription(notificationListener);
    };
  }, []);

  // 🔑 RECOVERY DE SESIÓN PERSISTENTE
  useEffect(() => {
    const loadSession = async () => {
      const savedUser = await storage.getItem('yale_user');
      if (savedUser) {
        setUser(savedUser);
      }
      setLoading(false);
    };
    loadSession();
  }, []);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };

  const handleLogout = async () => {
    await storage.removeItem('yale_user');
    setUser(null);
    setActiveRoomId(null);
  };

  if (loading) {
    return (
      <View className="flex-grow bg-dark-900 justify-center items-center">
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <View className="flex-grow bg-dark-900">
      <StatusBar style="light" />
      {!user ? (
        <Login onLoginSuccess={handleLoginSuccess} />
      ) : !activeRoomId ? (
        <Lobby 
          user={user} 
          onLogout={handleLogout} 
          onJoinRoom={(roomId) => setActiveRoomId(roomId)} 
        />
      ) : (
        <Room 
          key={activeRoomId}
          roomId={activeRoomId} 
          user={user} 
          onLeave={() => setActiveRoomId(null)} 
        />
      )}
    </View>
  );
}