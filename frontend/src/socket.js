import { io } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || '';

let socket = null;

export function connectSocket(token) {
  if (socket?.connected) return socket;

  socket = io(WS_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 10,
  });

  socket.on('connect', () => console.log('WS connected'));
  socket.on('disconnect', (reason) => console.log('WS disconnected:', reason));
  socket.on('connect_error', (err) => console.error('WS error:', err.message));

  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}

export function getSocket() { return socket; }
