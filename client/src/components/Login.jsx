import React, { useState } from 'react';
import { User, Rocket } from 'lucide-react';

const AVATAR_SEEDS = ['Felix', 'Aneka', 'Midnight', 'Spooky', 'Cuddles', 'Casper', 'Snuggles', 'Oliver'];

const Login = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_SEEDS[0]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim()) return;

    const userData = {
      username: username.trim(),
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${selectedAvatar}`
    };

    // Guardar en localStorage
    localStorage.setItem('yale_user', JSON.stringify(userData));
    onLoginSuccess(userData);
  };

  return (
    <div className="min-h-screen bg-dark-900 flex items-center justify-center p-4">
      <div className="bg-dark-800 w-full max-w-md rounded-3xl border border-dark-700 p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl mb-4 shadow-lg shadow-indigo-500/20">
            <Rocket className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white">Bienvenido a Yale</h1>
          <p className="text-gray-400 mt-2">Configura tu perfil para empezar a ver videos</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2 ml-1">Tu nombre de usuario</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ej. JuanitoPlayer"
                className="w-full bg-dark-900 border border-dark-700 rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-3 ml-1">Elige tu Avatar</label>
            <div className="grid grid-cols-4 gap-3">
              {AVATAR_SEEDS.map((seed) => (
                <button
                  key={seed}
                  type="button"
                  onClick={() => setSelectedAvatar(seed)}
                  className={`relative p-1 rounded-xl transition-all border-2 ${
                    selectedAvatar === seed ? 'border-indigo-500 bg-indigo-500/10' : 'border-transparent bg-dark-900 hover:border-dark-600'
                  }`}
                >
                  <img
                    src={`https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`}
                    alt="Avatar"
                    className="w-full h-auto rounded-lg"
                  />
                  {selectedAvatar === seed && (
                    <div className="absolute -top-1 -right-1 bg-indigo-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold">
                      ✓
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 group"
          >
            Entrar a Yale
            <Rocket className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
