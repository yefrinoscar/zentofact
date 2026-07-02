import apiHttp from './apiHttp';

// Desktop expone window.electronAPI (IPC). En web no existe, así que usamos el cliente HTTP.
// La misma UI corre en ambos: solo cambia esta pieza.
const api = (window as any).electronAPI || apiHttp;

export default api;
