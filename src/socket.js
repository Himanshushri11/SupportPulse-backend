const { Server } = require('socket.io');
const { logger } = require('./utils/logger');
const { config } = require('./config');

let io = null;

function initSocket(server, customOrigin) {
  const allowedOrigins = [
    'https://support-pulse-frontend.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];

  if (config.frontendUrl) {
    const cleanFrontendUrl = config.frontendUrl.replace(/\/+$/, '');
    if (!allowedOrigins.includes(cleanFrontendUrl)) {
      allowedOrigins.push(cleanFrontendUrl);
    }
  }

  if (customOrigin) {
    const cleanCustom = customOrigin.replace(/\/+$/, '');
    if (!allowedOrigins.includes(cleanCustom)) {
      allowedOrigins.push(cleanCustom);
    }
  }

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const cleanOrigin = origin.replace(/\/+$/, '');
        if (allowedOrigins.includes(cleanOrigin) || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`Socket.IO CORS policy: origin ${origin} not allowed`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

    io.on('connection', (socket) => {
        logger.info(`[Socket] Client connected: ${socket.id}`);

        socket.on('join-admin-room', () => {
            socket.join('admin-room');
            logger.info(`[Socket] Admin joined room: ${socket.id}`);
        });

        socket.on('disconnect', () => {
            logger.info(`[Socket] Client disconnected: ${socket.id}`);
        });
    });

    return io;
}

function getIO() {
    if (!io) {
        throw new Error('Socket.io not initialized. Call initSocket first.');
    }
    return io;
}

module.exports = { initSocket, getIO };