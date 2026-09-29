const { Router } = require('express');
const { authController } = require('./auth.controller');
const { validate } = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const {
  authLimiter,
  otpLimiter,
  passwordResetLimiter,
} = require('../../middleware/rateLimiter');
const {
  registerSchema,
  loginSchema,
  verifyEmailOtpSchema,
  verifyPhoneOtpSchema,
  resendOtpSchema,
  emailLoginRequestSchema,
  emailLoginVerifySchema,
  phoneLoginRequestSchema,
  phoneLoginVerifySchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
} = require('./auth.validation');

const router = Router();

// Registration
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  authController.register.bind(authController)
);

// OTP Verifications
router.post(
  '/verify-email-otp',
  authLimiter,
  validate(verifyEmailOtpSchema),
  authController.verifyEmailOtp.bind(authController)
);

router.post(
  '/verify-phone-otp',
  authLimiter,
  validate(verifyPhoneOtpSchema),
  authController.verifyPhoneOtp.bind(authController)
);

router.post(
  '/resend-otp',
  otpLimiter,
  validate(resendOtpSchema),
  authController.resendOtp.bind(authController)
);

// Password Login
router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  authController.login.bind(authController)
);

// Passwordless Email OTP Login
router.post(
  '/request-email-login-otp',
  otpLimiter,
  validate(emailLoginRequestSchema),
  authController.requestEmailLoginOtp.bind(authController)
);

router.post(
  '/verify-email-login-otp',
  authLimiter,
  validate(emailLoginVerifySchema),
  authController.verifyEmailLoginOtp.bind(authController)
);

// Passwordless Phone OTP Login
router.post(
  '/request-phone-login-otp',
  otpLimiter,
  validate(phoneLoginRequestSchema),
  authController.requestPhoneLoginOtp.bind(authController)
);

router.post(
  '/verify-phone-login-otp',
  authLimiter,
  validate(phoneLoginVerifySchema),
  authController.verifyPhoneLoginOtp.bind(authController)
);

// Forgot & Reset Password
router.post(
  '/forgot-password',
  passwordResetLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword.bind(authController)
);

router.post(
  '/reset-password',
  passwordResetLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword.bind(authController)
);

// Token Refresh & Logout
router.post(
  '/refresh',
  authLimiter,
  validate(refreshTokenSchema),
  authController.refreshToken.bind(authController)
);

router.post(
  '/logout',
  authController.logout.bind(authController)
);

// Authenticated current user profile
router.get(
  '/me',
  authenticate,
  authController.getMe.bind(authController)
);

module.exports = router;
