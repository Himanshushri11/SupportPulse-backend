const { z } = require('zod');
const { OtpPurpose } = require('../../constants/otp');

// Strong password regex: min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special character
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&_\-#])[A-Za-z\d@$!%*?&_\-#]{8,}$/;
const phoneRegex = /^\+?[1-9]\d{9,14}$/;

const registerSchema = z.object({
  fullName: z
    .string({ required_error: 'Full name is required' })
    .trim()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name cannot exceed 100 characters'),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  phone: z
    .string({ required_error: 'Phone number is required' })
    .trim()
    .regex(
      phoneRegex,
      'Please provide a valid phone number with country code (e.g. +919876543210 or 10-15 digits)'
    ),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .regex(
      passwordRegex,
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&_-#)'
    ),
  role: z
    .enum(['CUSTOMER', 'AGENT', 'ADMIN'], {
      errorMap: () => ({ message: 'Role must be one of: CUSTOMER, AGENT, ADMIN' }),
    })
    .optional()
    .default('CUSTOMER'),
});

const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password cannot be empty'),
});

const verifyEmailOtpSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  otp: z
    .string({ required_error: 'OTP code is required' })
    .trim()
    .regex(/^\d{6}$/, 'OTP code must be a 6-digit number'),
});

const verifyPhoneOtpSchema = z.object({
  phone: z
    .string({ required_error: 'Phone number is required' })
    .trim()
    .min(10, 'Please provide a valid phone number'),
  otp: z
    .string({ required_error: 'OTP code is required' })
    .trim()
    .regex(/^\d{6}$/, 'OTP code must be a 6-digit number'),
});

const resendOtpSchema = z.object({
  identifier: z
    .string({ required_error: 'Identifier (email or phone) is required' })
    .trim()
    .min(3, 'Identifier is required'),
  purpose: z.enum(Object.values(OtpPurpose), {
    errorMap: () => ({ message: `Invalid purpose. Must be one of: ${Object.values(OtpPurpose).join(', ')}` }),
  }),
});

const emailLoginRequestSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
});

const emailLoginVerifySchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  otp: z
    .string({ required_error: 'OTP code is required' })
    .trim()
    .regex(/^\d{6}$/, 'OTP code must be a 6-digit number'),
});

const phoneLoginRequestSchema = z.object({
  phone: z
    .string({ required_error: 'Phone number is required' })
    .trim()
    .min(10, 'Please provide a valid phone number'),
});

const phoneLoginVerifySchema = z.object({
  phone: z
    .string({ required_error: 'Phone number is required' })
    .trim()
    .min(10, 'Please provide a valid phone number'),
  otp: z
    .string({ required_error: 'OTP code is required' })
    .trim()
    .regex(/^\d{6}$/, 'OTP code must be a 6-digit number'),
});

const forgotPasswordSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
});

const resetPasswordSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Please provide a valid email address'),
  otp: z
    .string({ required_error: 'OTP code is required' })
    .trim()
    .regex(/^\d{6}$/, 'OTP code must be a 6-digit number'),
  newPassword: z
    .string({ required_error: 'New password is required' })
    .min(8, 'Password must be at least 8 characters')
    .regex(
      passwordRegex,
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
    ),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string({ required_error: 'Refresh token is required' }).min(1, 'Refresh token is required'),
});

module.exports = {
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
};
