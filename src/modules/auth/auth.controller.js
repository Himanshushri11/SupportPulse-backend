const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { User } = require('../user/user.model');
const { UserRole } = require('../../constants/roles');
const { OtpPurpose } = require('../../constants/otp');
const { otpService } = require('../otp/otp.service');
const { notificationService } = require('../../services/notification.service');
const { twilioService } = require('../../services/twilio.service');
const { logger } = require('../../utils/logger');
const {
  generateAuthTokens,
  verifyRefreshToken,
  hashToken,
  signAccessToken,
  signRefreshToken,
} = require('../../utils/jwt');
const {
  sendSuccess,
  sendCreated,
} = require('../../utils/response');
const {
  BadRequestError,
  UnauthorizedError,
  ConflictError,
  NotFoundError,
} = require('../../utils/errors');
const { config } = require('../../config');

class AuthController {
  /**
   * Register a new customer user
   */
  async register(req, res, next) {
    try {
      const { fullName, email, phone, password, role } = req.body;
      const normalizedEmail = email.toLowerCase().trim();
      const normalizedPhone = phone.trim();

      // Check duplicate email
      const existingEmail = await User.findOne({ email: normalizedEmail });
      if (existingEmail) {
        throw new ConflictError('An account with this email address already exists');
      }

      // Check duplicate phone
      const existingPhone = await User.findOne({ phone: normalizedPhone });
      if (existingPhone) {
        throw new ConflictError('An account with this phone number already exists');
      }

      // Hash password using bcrypt
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Determine user role based on input (defaults to CUSTOMER)
      const assignedRole = role && Object.values(UserRole).includes(role) ? role : UserRole.CUSTOMER;

      // Create user
      const user = await User.create({
        fullName,
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash,
        role: assignedRole,
        isEmailVerified: false,
        isPhoneVerified: false,
        isActive: true,
      });

      // Generate email verification OTP and send via SMTP (unchanged)
      try {
        const emailOtp = await otpService.generateOtp(
          normalizedEmail,
          OtpPurpose.EMAIL_VERIFICATION
        );
        await notificationService.sendEmailOtp({
          email: normalizedEmail,
          otp: emailOtp.otp,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
        });
      } catch (err) {
        // Log error without failing registration
      }

      // Send phone verification OTP via Twilio Verify (or simulation in dev)
      try {
        await twilioService.sendPhoneOtp(normalizedPhone);
      } catch (err) {
        // Log error without failing registration — user can resend
        logger.warn ? logger.warn(`Phone OTP send failed for ${normalizedPhone}: ${err.message}`) : null;
      }

      return sendCreated(
        res,
        {
          user: user.toJSON(),
        },
        'Registration successful. Please verify your email and phone number with the OTPs sent.'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify email OTP
   */
  async verifyEmailOtp(req, res, next) {
    try {
      const { email, otp } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      await otpService.verifyOtp(normalizedEmail, OtpPurpose.EMAIL_VERIFICATION, otp);

      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        throw new NotFoundError('User not found');
      }

      user.isEmailVerified = true;
      await user.save();

      return sendSuccess(
        res,
        {
          user: user.toJSON(),
        },
        'Email address verified successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify phone OTP (registration step) via Twilio Verify
   */
  async verifyPhoneOtp(req, res, next) {
    try {
      const { phone, otp } = req.body;
      const normalizedPhone = phone.trim();

      // Delegate entirely to Twilio Verify (or simulation in dev)
      await twilioService.verifyPhoneOtp(normalizedPhone, otp);

      const user = await User.findOne({ phone: normalizedPhone });
      if (!user) {
        throw new NotFoundError('User not found');
      }

      user.isPhoneVerified = true;
      await user.save();

      return sendSuccess(
        res,
        { user: user.toJSON() },
        'Phone number verified successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Resend OTP for email verification, phone verification, login, or password reset
   */
  async resendOtp(req, res, next) {
    try {
      const { identifier, purpose } = req.body;
      const normalizedIdentifier = identifier.trim();

      const isPhonePurpose =
        purpose === OtpPurpose.PHONE_VERIFICATION ||
        purpose === OtpPurpose.PHONE_LOGIN;

      if (isPhonePurpose) {
        // Phone OTP: re-trigger Twilio Verify (Twilio manages its own cooldown)
        await twilioService.sendPhoneOtp(normalizedIdentifier);
        return sendSuccess(
          res,
          null,
          'A new verification code has been dispatched to your phone.'
        );
      }

      // Email / password-reset OTPs: use local otpService + SMTP
      const newOtp = await otpService.resendOtp(normalizedIdentifier, purpose);
      await notificationService.sendEmailOtp({
        email: normalizedIdentifier,
        otp: newOtp.otp,
        purpose,
      });

      return sendSuccess(
        res,
        { expiresAt: newOtp.expiresAt },
        'A new verification code has been dispatched.'
      );
    } catch (error) {
      next(error);
    }
  }


  /**
   * Login with email and password
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      const user = await User.findOne({ email: normalizedEmail }).select(
        '+passwordHash +refreshTokens'
      );

      if (!user) {
        throw new UnauthorizedError('Invalid email or password');
      }

      // Check account lockout
      if (user.isLocked()) {
        const lockoutMinutes = Math.ceil(
          (user.lockUntil.getTime() - Date.now()) / (60 * 1000)
        );
        throw new UnauthorizedError(
          `Account is temporarily locked due to multiple failed login attempts. Please try again after ${lockoutMinutes} minute(s).`
        );
      }

      // Check active status
      if (!user.isActive) {
        throw new UnauthorizedError('Account has been deactivated. Please contact support.');
      }

      // Compare password
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        user.failedLoginAttempts += 1;
        if (user.failedLoginAttempts >= 5) {
          user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15-minute lock
        }
        await user.save();
        throw new UnauthorizedError('Invalid email or password');
      }

      // Successful password match - clear locks and failed counters
      user.failedLoginAttempts = 0;
      user.lockUntil = null;

      // Issue access and refresh tokens
      const tokens = await generateAuthTokens(user);

      return sendSuccess(
        res,
        {
          user: user.toJSON(),
          tokens,
        },
        'Login successful'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request email OTP for passwordless login
   */
  async requestEmailLoginOtp(req, res, next) {
    try {
      const { email } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      const user = await User.findOne({ email: normalizedEmail, isActive: true });

      // If user exists, generate and send OTP; do not disclose existence if non-existent
      if (user) {
        const otpResult = await otpService.generateOtp(
          normalizedEmail,
          OtpPurpose.EMAIL_LOGIN
        );
        await notificationService.sendEmailOtp({
          email: normalizedEmail,
          otp: otpResult.otp,
          purpose: OtpPurpose.EMAIL_LOGIN,
        });
      }

      return sendSuccess(
        res,
        null,
        'If an account exists with this email, a sign-in code has been sent.'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify email OTP and complete passwordless login
   */
  async verifyEmailLoginOtp(req, res, next) {
    try {
      const { email, otp } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      await otpService.verifyOtp(normalizedEmail, OtpPurpose.EMAIL_LOGIN, otp);

      const user = await User.findOne({ email: normalizedEmail, isActive: true }).select(
        '+refreshTokens'
      );

      if (!user) {
        throw new UnauthorizedError('Account not found or inactive');
      }

      user.isEmailVerified = true;
      const tokens = await generateAuthTokens(user);

      return sendSuccess(
        res,
        {
          user: user.toJSON(),
          tokens,
        },
        'Signed in successfully with email verification'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Request phone OTP for passwordless login via Twilio Verify
   */
  async requestPhoneLoginOtp(req, res, next) {
    try {
      const { phone } = req.body;
      const normalizedPhone = phone.trim();

      const user = await User.findOne({ phone: normalizedPhone, isActive: true });

      if (user) {
        // Delegate to Twilio Verify — no local OTP stored for phone
        await twilioService.sendPhoneOtp(normalizedPhone);
      }

      return sendSuccess(
        res,
        null,
        'If an account exists with this phone number, a sign-in code has been sent.'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify phone OTP and complete passwordless login via Twilio Verify
   */
  async verifyPhoneLoginOtp(req, res, next) {
    try {
      const { phone, otp } = req.body;
      const normalizedPhone = phone.trim();

      // Delegate check to Twilio Verify (or simulation in dev)
      await twilioService.verifyPhoneOtp(normalizedPhone, otp);

      const user = await User.findOne({ phone: normalizedPhone, isActive: true }).select(
        '+refreshTokens'
      );

      if (!user) {
        throw new UnauthorizedError('Account not found or inactive');
      }

      user.isPhoneVerified = true;
      const tokens = await generateAuthTokens(user);

      return sendSuccess(
        res,
        { user: user.toJSON(), tokens },
        'Signed in successfully with phone verification'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Initiate forgot password flow
   */
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      const user = await User.findOne({ email: normalizedEmail, isActive: true });

      if (user) {
        const otpResult = await otpService.generateOtp(
          normalizedEmail,
          OtpPurpose.PASSWORD_RESET
        );
        await notificationService.sendEmailOtp({
          email: normalizedEmail,
          otp: otpResult.otp,
          purpose: OtpPurpose.PASSWORD_RESET,
        });
      }

      return sendSuccess(
        res,
        null,
        'If an account is associated with that email, password reset instructions have been sent.'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Complete password reset using verified OTP
   */
  async resetPassword(req, res, next) {
    try {
      const { email, otp, newPassword } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      // Verify OTP for password reset
      await otpService.verifyOtp(normalizedEmail, OtpPurpose.PASSWORD_RESET, otp);

      const user = await User.findOne({ email: normalizedEmail, isActive: true }).select(
        '+passwordHash +refreshTokens'
      );

      if (!user) {
        throw new BadRequestError('Password reset request could not be processed');
      }

      // Hash new password
      user.passwordHash = await bcrypt.hash(newPassword, 12);
      // Invalidate all active sessions upon password reset for security
      user.refreshTokens = [];
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      await user.save();

      return sendSuccess(
        res,
        null,
        'Your password has been successfully reset. Please log in with your new password.'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Rotate and refresh access token using a valid refresh token
   */
  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;

      // Verify refresh token signature & expiration
      const decoded = verifyRefreshToken(refreshToken);

      const user = await User.findById(decoded.userId).select('+refreshTokens');
      if (!user || !user.isActive) {
        throw new UnauthorizedError('Session is invalid or account deactivated');
      }

      // Find token record in user whitelist by jti
      const incomingTokenHash = hashToken(refreshToken);
      const tokenIndex = user.refreshTokens.findIndex(
        (t) => t.jti === decoded.jti && t.tokenHash === incomingTokenHash
      );

      // If token is missing, detect token reuse attack and invalidate all sessions!
      if (tokenIndex === -1) {
        user.refreshTokens = [];
        await user.save();
        throw new UnauthorizedError(
          'Compromised or already used refresh token detected. All active sessions have been terminated for security.'
        );
      }

      // Remove the used refresh token (rotation)
      user.refreshTokens.splice(tokenIndex, 1);

      // Issue new access and refresh tokens
      const newJti = crypto.randomUUID();
      const newAccessToken = signAccessToken({
        userId: user._id.toString(),
        role: user.role,
      });
      const newRefreshToken = signRefreshToken({
        userId: user._id.toString(),
        jti: newJti,
      });

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      user.refreshTokens.push({
        tokenHash: hashToken(newRefreshToken),
        jti: newJti,
        expiresAt,
        createdAt: new Date(),
      });

      await user.save();

      return sendSuccess(
        res,
        {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: config.jwt.accessExpiresIn,
        },
        'Token refreshed successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Log out user by invalidating the refresh token
   */
  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (refreshToken) {
        try {
          const decoded = verifyRefreshToken(refreshToken);
          const user = await User.findById(decoded.userId).select('+refreshTokens');
          if (user) {
            user.refreshTokens = user.refreshTokens.filter((t) => t.jti !== decoded.jti);
            await user.save();
          }
        } catch (e) {
          // Token may already be expired or invalid
        }
      } else if (req.user) {
        // If authenticated via Bearer token and no specific refresh token sent, clear current user sessions
        const user = await User.findById(req.user._id).select('+refreshTokens');
        if (user) {
          user.refreshTokens = [];
          await user.save();
        }
      }

      return sendSuccess(res, null, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieve current authenticated user profile
   */
  async getMe(req, res) {
    return sendSuccess(
      res,
      {
        user: req.user.toJSON(),
      },
      'User profile fetched successfully'
    );
  }
}

const authController = new AuthController();

module.exports = {
  AuthController,
  authController,
};
