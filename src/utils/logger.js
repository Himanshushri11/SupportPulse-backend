const winston = require('winston');
const { config } = require('../config');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let out = `[${timestamp}] ${level}: ${message}`;
    if (Object.keys(meta).length > 0) {
      out += ` ${JSON.stringify(meta)}`;
    }
    if (stack) {
      out += `\n${stack}`;
    }
    return out;
  })
);

const logger = winston.createLogger({
  level: config.env === 'development' ? 'debug' : 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: config.env === 'development' ? consoleFormat : logFormat,
    }),
  ],
});

module.exports = {
  logger,
};
