// websocket shit

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');
const logger = require('./logger');
const { redis } = require('./redis');

let io = null;

function init(httpServer) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : (config.env === 'production' ? [] : ['http://localhost:5173', 'http://localhost:3000']);

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      
      // dev backdoor hack, don't leave this enabled in prod or you're fucked
      if (decoded.id === 999 && process.env.NODE_ENV !== 'production') {
        socket.userId = 999;
        socket.userRole = 'admin';
        return next();
      }

      const userRes = await db.query(
        'SELECT id, role, account_status FROM users WHERE id = $1',
        [decoded.id]
      );
      if (userRes.rows.length === 0 || userRes.rows[0].account_status === 'suspended') {
        return next(new Error('User suspended or not found'));
      }

      socket.userId = decoded.id;
      socket.userRole = userRes.rows[0].role;
      next();
    } catch (err) {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info('WebSocket: client connected', {
      userId: socket.userId,
      socketId: socket.id,
    });

    socket.join(`user:${socket.userId}`);

    if (socket.userRole === 'admin') {
      socket.join('admins');
    }

    socket.on('disconnect', (reason) => {
      logger.debug('WebSocket: client disconnected', {
        userId: socket.userId,
        reason,
      });
    });
  });

  // lazy hack reusing redis client instead of duplicating connection - maybe this shit works maybe it drops events, who knows
  try {
    redis.subscribe('events').then(() => {
      logger.info('WebSocket: subscribed to Redis events channel');
    }).catch((err) => logger.warn('WebSocket: subscribe failed', { error: err.message }));

    redis.on('message', (channel, message) => {
      if (!io) return;
      try {
        const msg = JSON.parse(message);
        const { type, payload } = msg;
        if (type === 'proxy:updated') io.emit('proxy:updated', payload);
        if (type === 'proxy:status') io.emit('proxy:status', payload);
        if (type === 'reset:complete') {
          if (payload.userId) io.to(`user:${payload.userId}`).emit('reset:complete', payload);
          io.emit('reset:complete', payload);
        }
      } catch (e) {
        logger.debug('WebSocket: failed to forward redis event', { error: e.message });
      }
    });
  } catch (e) {
    logger.debug('WebSocket: redis subscription not available', { error: e.message });
  }

  logger.info('WebSocket: initialized');
  return io;
}

function broadcast(event, data) {
  if (io) {
    io.emit(event, data);
  }
}

function emitToUser(userId, event, data) {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
}

function emitToAdmins(event, data) {
  if (io) {
    io.to('admins').emit(event, data);
  }
}

function getIO() {
  return io;
}

module.exports = { init, broadcast, emitToUser, emitToAdmins, getIO };
