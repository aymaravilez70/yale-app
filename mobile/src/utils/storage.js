import AsyncStorage from '@react-native-async-storage/async-storage';

export const storage = {
  /**
   * Obtiene y parsea un elemento desde AsyncStorage
   * @param {string} key Clave a buscar
   */
  async getItem(key) {
    try {
      const val = await AsyncStorage.getItem(key);
      return val ? JSON.parse(val) : null;
    } catch (e) {
      console.error(`[Storage] Error leyendo clave "${key}":`, e);
      return null;
    }
  },

  /**
   * Serializa y guarda un elemento en AsyncStorage
   * @param {string} key Clave a guardar
   * @param {any} val Valor a guardar
   */
  async setItem(key, val) {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.error(`[Storage] Error escribiendo clave "${key}":`, e);
    }
  },

  /**
   * Elimina un elemento de AsyncStorage
   * @param {string} key Clave a eliminar
   */
  async removeItem(key) {
    try {
      await AsyncStorage.removeItem(key);
    } catch (e) {
      console.error(`[Storage] Error eliminando clave "${key}":`, e);
    }
  }
};

export default storage;
