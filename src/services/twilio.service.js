/**
 * twilioService — Twilio Verify API wrapper for phone OTP.
 *
 * Architecture:
 * - Delegates OTP generation and verification entirely to Twilio Verify.
 * - Never generates or stores plaintext OTP codes locally.
 * - Gracefully degrades to simulation when credentials are missing (dev only).
 * - All Twilio errors are mapped to project-standard error types.
 * - Credentials are NEVER logged.
 */

const { config } = require('../config');
const { logger } = require('../utils/logger');
const { BadRequestError, AppError } = require('../utils/errors');

// ─── Phone number helpers ─────────────────────────────────────────────────────

/**
 * Normalize a phone number to E.164 format.
 * Handles Indian numbers (+91 / 91 / 10-digit).
 * Returns null if the number cannot be normalized.
 */
function normalizeE164(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const digits = raw.replace(/[\s\-().]/g, '');

  // Already in E.164 (+XXXXXXXXXXX)
  if (/^\+\d{7,15}$/.test(digits)) return digits;

  // Indian: 91XXXXXXXXXX (12 digits, starts with 91)
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;

  // Indian: 10-digit local number
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;

  return null;
}

// ─── Twilio error → project error mapper ─────────────────────────────────────

function mapTwilioError(err) {
  const code = err.code || err.status;

  const errorMap = {
    // Verification errors
    60200: 'Invalid phone number. Please use a valid E.164 format (e.g. +919876543210).',
    60202: 'Maximum check attempts reached. Please request a new OTP.',
    60203: 'Maximum OTP requests reached. Please try again after some time.',
    60212: 'Invalid verification code.',
    60205: 'Verification code has expired. Please request a new one.',
    // Auth / config errors
    20003: 'Twilio authentication failed. Check server configuration.',
    20404: 'Twilio Verify Service not found. Check TWILIO_VERIFY_SERVICE_SID.',
    // Generic
    21211: 'Invalid phone number.',
    21614: 'This phone number is not a mobile number and cannot receive SMS.',
  };

  const message = errorMap[code] || `SMS service error. Please try again later.`;
  return new BadRequestError(message);
}

// ─── Service class ────────────────────────────────────────────────────────────

class TwilioService {
  constructor() {
    this.client = null;
    this.verifyServiceSid = null;
    this.configured = false;
    this._init();
  }

  _init() {
    const { accountSid, authToken, verifyServiceSid } = config.twilio;

    if (accountSid && authToken && verifyServiceSid) {
      try {
        // Lazy-require so tests can mock the module before it loads
        const twilio = require('twilio');
        this.client = twilio(accountSid, authToken);
        this.verifyServiceSid = verifyServiceSid;
        this.configured = true;
        logger.info('[TwilioService] Initialized with real Twilio Verify credentials.');
      } catch (err) {
        logger.error(`[TwilioService] Failed to initialize Twilio client: ${err.message}`);
      }
    } else {
      logger.warn(
        '[TwilioService] TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID not configured. ' +
        'Phone OTP will be simulated (development mode only).'
      );
    }
  }

  /**
   * Validate and normalize phone number.
   * Throws BadRequestError for malformed numbers.
   */
  _resolvePhone(rawPhone) {
    const e164 = normalizeE164(rawPhone);
    if (!e164) {
      throw new BadRequestError(
        'Invalid phone number format. Please provide a number in E.164 format (e.g. +919876543210).'
      );
    }
    return e164;
  }

  /**
   * Send a phone OTP via Twilio Verify SMS.
   *
   * In production (configured): delegates fully to Twilio — no local OTP stored.
   * In development (not configured): logs a simulation message and returns true.
   *
   * @param {string} phoneNumber — Raw phone number (will be normalized)
   * @returns {Promise<{ success: boolean, simulated: boolean }>}
   */
  async sendPhoneOtp(phoneNumber) {
    const e164 = this._resolvePhone(phoneNumber);

    if (!this.configured) {
      // Development simulation — never in production
      logger.info(`[TwilioService][SIM] Phone OTP simulation for ${e164}. Configure Twilio credentials for real SMS.`);
      return { success: true, simulated: true };
    }

    try {
      await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verifications
        .create({ to: e164, channel: 'sms' });

      logger.info(`[TwilioService] Verification SMS sent to ${e164}`);
      return { success: true, simulated: false };
    } catch (err) {
      logger.error(`[TwilioService] Failed to send verification to ${e164}: ${err.message} (code: ${err.code})`);
      throw mapTwilioError(err);
    }
  }

  /**
   * Verify a phone OTP via Twilio Verify check.
   *
   * In production (configured): delegates check to Twilio.
   * In development (not configured): accepts any 6-digit code.
   *
   * @param {string} phoneNumber — Raw phone number
   * @param {string} code       — User-entered OTP
   * @returns {Promise<boolean>} — true if approved
   */
  async verifyPhoneOtp(phoneNumber, code) {
    const e164 = this._resolvePhone(phoneNumber);

    if (!this.configured) {
      // Development simulation — accept any 6-digit code
      if (/^\d{6}$/.test(String(code))) {
        logger.info(`[TwilioService][SIM] Accepted simulated OTP for ${e164}`);
        return true;
      }
      throw new BadRequestError('Invalid OTP. Provide a 6-digit code.');
    }

    try {
      const check = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verificationChecks
        .create({ to: e164, code: String(code) });

      if (check.status === 'approved') {
        logger.info(`[TwilioService] Verification approved for ${e164}`);
        return true;
      }

      // Twilio returned pending/canceled/failed
      logger.warn(`[TwilioService] Verification not approved for ${e164}: status=${check.status}`);
      throw new BadRequestError('Invalid or expired OTP. Please request a new one.');
    } catch (err) {
      if (err instanceof BadRequestError) throw err;
      logger.error(`[TwilioService] Verify check failed for ${e164}: ${err.message} (code: ${err.code})`);
      throw mapTwilioError(err);
    }
  }

  /** Expose normalizer for use in controller/validation */
  normalizePhone(raw) {
    return normalizeE164(raw);
  }

  /** Whether real Twilio is configured */
  isConfigured() {
    return this.configured;
  }
}

const twilioService = new TwilioService();

module.exports = {
  TwilioService,
  twilioService,
  normalizeE164,
};
