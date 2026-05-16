import { useState, useEffect } from 'react';
import Login from './components/Login';
import Lobby from './components/lobby/Lobby';
import Room from './components/room/Room';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentRoomId, setCurrentRoomId] = useState(null);

  useEffect(() => {
    // 1. Verificar si hay un usuario en LocalStorage al cargar la app
    const savedUser = localStorage.getItem('yale_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error("Error cargando usuario del localStorage", e);
        localStorage.removeItem('yale_user');
      }
    }
    setLoading(false);
  }, []);

  const handleLogin = (userData) => {
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('yale_user');
    setUser(null);
    setCurrentRoomId(null);
  };

  const handleJoinRoom = (roomId) => {
    setCurrentRoomId(roomId);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-900 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-dark-900 text-white font-sans selection:bg-indigo-500/30 overflow-hidden">
      {!user ? (
        <Login onLoginSuccess={handleLogin} />
      ) : !currentRoomId ? (
        <Lobby user={user} onLogout={handleLogout} onJoinRoom={handleJoinRoom} />
      ) : (
        <Room 
          roomId={currentRoomId} 
          user={user} 
          onLeave={() => setCurrentRoomId(null)} 
        />
      )}
    </div>
  );
}

export default App;
