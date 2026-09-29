const rateLimit = require('express-rate-limit');
const { config } = require('../config');

// General authentication rate limiter (login, refresh, register)
const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // 15 mins
  max: config.rateLimit.authMax || 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts from this IP. Please try again after 15 minutes.',
  },
});

// Stricter rate limiter for OTP generation/resend to prevent SMS/email bombing
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many OTP requests from this IP. Please wait 15 minutes before requesting again.',
  },
});

// Password reset limiter to prevent enumeration and spam
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many password reset requests from this IP. Please try again after 15 minutes.',
  },
});

module.exports = {
  authLimiter,
  otpLimiter,
  passwordResetLimiter,
};
