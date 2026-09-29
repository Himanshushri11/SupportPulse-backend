const crypto = require('crypto');
const { Otp } = require('./otp.model');
const { OtpPurpose } = require('../../constants/otp');
const { config } = require('../../config');
const { BadRequestError } = require('../../utils/errors');
const { logger } = require('../../utils/logger');

class OtpService {
  /**
   * Hashes a 6-digit plain OTP with a secret HMAC key
   */
  hashOtp(plainOtp, identifier, purpose) {
    return crypto
      .createHmac('sha256', config.jwt.accessSecret)
      .update(`${identifier}:${purpose}:${plainOtp}`)
      .digest('hex');
  }

  /**
   * Generates a cryptographically secure 6-digit OTP
   * Enforces cooldown and invalidates any previous OTP for this identifier & purpose
   */
  async generateOtp(identifier, purpose, options = {}) {
    const normalizedIdentifier = identifier.toLowerCase().trim();

    // Check for existing active OTP
    const existingOtp = await Otp.findOne({
      identifier: normalizedIdentifier,
      purpose,
    });

    if (existingOtp) {
      const timeSinceLastSent = (Date.now() - existingOtp.lastSentAt.getTime()) / 1000;
      const cooldownRemaining = Math.ceil(config.otp.cooldownSeconds - timeSinceLastSent);

      if (!options.skipCooldown && cooldownRemaining > 0) {
        throw new BadRequestError(
          `Please wait ${cooldownRemaining} second(s) before requesting another OTP`
        );
      }

      // Invalidate the old OTP
      await Otp.deleteOne({ _id: existingOtp._id });
    }

    // Cryptographically secure 6-digit OTP
    const plainOtp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = this.hashOtp(plainOtp, normalizedIdentifier, purpose);
    const expiresAt = new Date(Date.now() + config.otp.expiryMinutes * 60 * 1000);

    await Otp.create({
      identifier: normalizedIdentifier,
      purpose,
      otpHash,
      expiresAt,
      attempts: 0,
      lastSentAt: new Date(),
      resendCount: existingOtp ? existingOtp.resendCount + 1 : 1,
    });

    // In development mode, allow controlled debug inspection without logging in production
    if (config.env === 'development') {
      logger.debug(`[DEV ONLY] OTP for ${normalizedIdentifier} (${purpose}): ${plainOtp}`);
    }

    return {
      otp: plainOtp,
      expiresAt,
    };
  }

  /**
   * Verifies an OTP against stored hash, enforcing expiration and attempt limits
   */
  async verifyOtp(identifier, purpose, plainOtp) {
    const normalizedIdentifier = identifier.toLowerCase().trim();

    const otpRecord = await Otp.findOne({
      identifier: normalizedIdentifier,
      purpose,
    });

    if (!otpRecord) {
      throw new BadRequestError('Invalid or expired OTP. Please request a new one.');
    }

    // Check if expired
    if (new Date() > otpRecord.expiresAt) {
      await Otp.deleteOne({ _id: otpRecord._id });
      throw new BadRequestError('OTP has expired. Please request a new one.');
    }

    // Check maximum verification attempts
    if (otpRecord.attempts >= config.otp.maxAttempts) {
      await Otp.deleteOne({ _id: otpRecord._id });
      throw new BadRequestError(
        'Maximum verification attempts exceeded. This OTP has been invalidated. Please request a new one.'
      );
    }

    const computedHash = this.hashOtp(plainOtp, normalizedIdentifier, purpose);

    // Constant-time comparison to prevent timing attacks
    const isMatch = crypto.timingSafeEqual(
      Buffer.from(computedHash, 'utf8'),
      Buffer.from(otpRecord.otpHash, 'utf8')
    );

    if (!isMatch) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      const remainingAttempts = config.otp.maxAttempts - otpRecord.attempts;

      throw new BadRequestError(
        `Invalid OTP. You have ${remainingAttempts} attempt(s) remaining.`
      );
    }

    // Verification successful - immediately invalidate/remove OTP
    await Otp.deleteOne({ _id: otpRecord._id });
    return true;
  }

  /**
   * Resend OTP for a given identifier and purpose
   */
  async resendOtp(identifier, purpose) {
    return this.generateOtp(identifier, purpose);
  }
}

const otpService = new OtpService();

module.exports = {
  OtpService,
  otpService,
};
