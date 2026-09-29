const dns = require('dns');
// Fix Windows ISP DNS resolving issue with MongoDB Atlas SRV records
dns.setServers(['8.8.8.8', '1.1.1.1']);

const http = require('http');
const { createApp } = require('./app');
const { config } = require('./config');
const { connectDatabase } = require('./database/connection');
const { logger } = require('./utils/logger');
const { notificationService } = require('./services/notification.service');
const { initSocket } = require('./socket');

const startServer = async () => {
  await connectDatabase();
  await notificationService.verifyConnection();

  const app = createApp();

  const server = http.createServer(app);

  initSocket(server, config.frontendUrl);

  server.listen(config.port, '0.0.0.0', () => {
    logger.info(`Server running in ${config.env} mode on port ${config.port}`);
    logger.info(`Health check available at /api/health`);
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received. Initiating graceful shutdown...`);
    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

startServer().catch((error) => {
  logger.error('Failed to start server: %o', error);
  process.exit(1);
});