const { Server } = require('socket.io');
const { logger } = require('./utils/logger');

let io = null;

function initSocket(server, corsOrigin) {
    io = new Server(server, {
        cors: {
            origin: corsOrigin || '*',
            methods: ['GET', 'POST'],
        },
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