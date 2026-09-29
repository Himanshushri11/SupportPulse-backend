const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:5000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ticketing_system',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_jwt_access_super_secret_key_change_in_prod_12345',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_jwt_refresh_super_secret_key_change_in_prod_67890',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  email: {
    hmacSecret: process.env.EMAIL_HMAC_SECRET || 'dev_email_hmac_secret_key_54321',
    inboundDomain: process.env.EMAIL_INBOUND_DOMAIN || 'support.yourdomain.com',
    from: process.env.SMTP_FROM || process.env.EMAIL_FROM || 'Email Support System <support@yourdomain.com>',
    adminSupportEmail: process.env.ADMIN_SUPPORT_EMAIL || 'admin@yourdomain.com',
    webhookSecret: process.env.EMAIL_WEBHOOK_SECRET || 'dev_webhook_shared_secret_999',
    brevoApiKey: process.env.BREVO_API_KEY || '',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '',
    },
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 mins
    max: parseInt(process.env.RATE_LIMIT_MAX || '1000', 10),
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '50', 10),
  },

  otp: {
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
    cooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '60', 10),
  },

  upload: {
    maxFileSizeBytes: (parseInt(process.env.UPLOAD_MAX_FILE_SIZE_MB || '5', 10)) * 1024 * 1024,
    allowedMimeTypes: (process.env.ALLOWED_UPLOAD_MIME_TYPES || 'image/jpeg,image/png,image/webp,application/pdf,text/plain').split(','),
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || '',
  },
};

module.exports = {
  config,
};
