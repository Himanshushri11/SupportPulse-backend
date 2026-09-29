const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { config } = require('./config');
const { errorHandler } = require('./middleware/errorHandler');
const healthRoutes = require('./modules/health/health.routes');
const authRoutes = require('./modules/auth/auth.routes');
const ticketRoutes = require('./modules/ticket/ticket.routes');
const categoryRoutes = require('./modules/category/category.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const { NotFoundError } = require('./utils/errors');

const createApp = () => {
  const app = express();

  // Trust proxy if deployed behind reverse proxy
  app.set('trust proxy', 1);

  // Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // allow swagger UI & assets
      crossOriginEmbedderPolicy: false,
    })
  );

  // Permitted origins for Express CORS (handles trailing slashes & dynamic Vercel domains)
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

  // CORS configuration
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        const cleanOrigin = origin.replace(/\/+$/, '');
        if (allowedOrigins.includes(cleanOrigin) || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS policy: origin ${origin} not allowed`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-webhook-signature'],
    })
  );

  // Global Rate Limiter
  const globalLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many requests from this IP, please try again after 15 minutes',
    },
  });
  app.use('/api', globalLimiter);

  // Body Parsers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Static uploads directory
  app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));

  // Health check
  app.use('/api/health', healthRoutes);

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/dashboard', dashboardRoutes);

  // Root welcome
  app.get('/', (req, res) => {
    res.json({
      name: 'Email Support System API',
      version: '1.0.0',
      status: 'active',
      docs: '/api/docs',
      health: '/api/health',
    });
  });

  // 404 Handler for undefined routes
  app.use((req, res, next) => {
    next(new NotFoundError(`Cannot find ${req.method} ${req.originalUrl} on this server`));
  });

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
};

module.exports = {
  createApp,
};
