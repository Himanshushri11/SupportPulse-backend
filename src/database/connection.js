const mongoose = require('mongoose');
const { config } = require('../config');
const { logger } = require('../utils/logger');

const connectDatabase = async () => {
  try {
    mongoose.set('strictQuery', true);
    const conn = await mongoose.connect(config.mongo.uri);
    logger.info(`MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    logger.error('Error connecting to MongoDB: %o', error);
    process.exit(1);
  }
};

const disconnectDatabase = async () => {
  await mongoose.disconnect();
  logger.info('MongoDB Disconnected');
};

module.exports = {
  connectDatabase,
  disconnectDatabase,
};
