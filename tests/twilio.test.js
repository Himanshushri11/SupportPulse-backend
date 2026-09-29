/**
 * Twilio SMS OTP Tests
 *
 * Two strategies:
 * A) TwilioService unit tests — instantiate fresh instances with controlled credentials
 * B) Integration tests via HTTP endpoints — mock the twilioService singleton directly
 *
 * No real Twilio API calls. No real SMTP. Jest mocks throughout.
 */

const request = require('supertest');
const mongoose = require('mongoose');

// ─── Mock nodemailer (email tests won't fail due to SMTP) ────────────────────
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    verify: jest.fn().mockResolvedValue(true),
    sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-id' }),
  })),
}));

// ─── Mock the twilio npm package globally ───────────────────────────────────
const mockVerificationsCreate = jest.fn();
const mockVerificationChecksCreate = jest.fn();
const mockServicesFactory = jest.fn(() => ({
  verifications: { create: mockVerificationsCreate },
  verificationChecks: { create: mockVerificationChecksCreate },
}));

jest.mock('twilio', () =>
  jest.fn(() => ({
    verify: { v2: { services: mockServicesFactory } },
  }))
);

// ─── Load modules AFTER mocks ────────────────────────────────────────────────
const { createApp } = require('../src/app');
const { config } = require('../src/config');
const { User } = require('../src/modules/user/user.model');
const { Otp } = require('../src/modules/otp/otp.model');
const { UserRole } = require('../src/constants/roles');
const { normalizeE164 } = require('../src/services/twilio.service');

// ─────────────────────────────────────────────────────────────────────────────
describe('Twilio SMS OTP', () => {
  let app;
  const TEST_PHONE = '+919876543210';
  const TEST_EMAIL = 'twiliotest@smstest.com';

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongo.uri);
    }
    app = createApp();
  });

  afterAll(async () => {
    await User.deleteMany({ email: TEST_EMAIL });
    await Otp.deleteMany({ identifier: TEST_EMAIL });
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });

  beforeEach(async () => {
    mockVerificationsCreate.mockClear();
    mockVerificationChecksCreate.mockClear();
    mockServicesFactory.mockClear();
    await User.deleteMany({ email: TEST_EMAIL });
    await Otp.deleteMany({ identifier: TEST_EMAIL });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Phone Number Normalization (E.164)
  // ══════════════════════════════════════════════════════════════════════════
  describe('normalizeE164()', () => {
    it('accepts already-valid E.164 with country code', () => {
      expect(normalizeE164('+919876543210')).toBe('+919876543210');
    });

    it('normalizes 10-digit Indian mobile number', () => {
      expect(normalizeE164('9876543210')).toBe('+919876543210');
    });

    it('normalizes 91XXXXXXXXXX (12 digits) format', () => {
      expect(normalizeE164('919876543210')).toBe('+919876543210');
    });

    it('strips dashes and spaces', () => {
      expect(normalizeE164('+91 98765-43210')).toBe('+919876543210');
    });

    it('returns null for clearly invalid input', () => {
      expect(normalizeE164('12345')).toBeNull();
      expect(normalizeE164('')).toBeNull();
      expect(normalizeE164(null)).toBeNull();
      expect(normalizeE164('not-a-phone')).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. TwilioService unit tests (instantiate with fake credentials)
  //    The global mock of 'twilio' ensures the SDK is already mocked.
  // ══════════════════════════════════════════════════════════════════════════
  describe('TwilioService unit (configured mode)', () => {
    let svc;

    beforeAll(() => {
      // Inject fake creds into config at test time
      config.twilio.accountSid = 'ACfaketest';
      config.twilio.authToken = 'fakeauthtoken';
      config.twilio.verifyServiceSid = 'VAfaketest';

      const { TwilioService } = require('../src/services/twilio.service');
      svc = new TwilioService();
    });

    afterAll(() => {
      config.twilio.accountSid = '';
      config.twilio.authToken = '';
      config.twilio.verifyServiceSid = '';
    });

    it('isConfigured() returns true with credentials', () => {
      expect(svc.isConfigured()).toBe(true);
    });

    it('sendPhoneOtp: calls Twilio verifications.create with E.164 number', async () => {
      mockVerificationsCreate.mockResolvedValue({ status: 'pending', sid: 'VEtest' });
      const result = await svc.sendPhoneOtp('+919876543210');
      expect(result.success).toBe(true);
      expect(result.simulated).toBe(false);
      expect(mockVerificationsCreate).toHaveBeenCalledWith({ to: '+919876543210', channel: 'sms' });
    });

    it('sendPhoneOtp: normalizes 10-digit number before calling Twilio', async () => {
      mockVerificationsCreate.mockResolvedValue({ status: 'pending' });
      await svc.sendPhoneOtp('9876543210');
      expect(mockVerificationsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ to: '+919876543210' })
      );
    });

    it('sendPhoneOtp: throws BadRequestError on invalid number', async () => {
      await expect(svc.sendPhoneOtp('12345')).rejects.toThrow(/invalid phone number/i);
      expect(mockVerificationsCreate).not.toHaveBeenCalled();
    });

    it('sendPhoneOtp: maps Twilio error code 60200 to readable error', async () => {
      const err = new Error('Twilio API error'); err.code = 60200;
      mockVerificationsCreate.mockRejectedValue(err);
      await expect(svc.sendPhoneOtp('+919876543210')).rejects.toThrow(/invalid phone number/i);
    });

    it('verifyPhoneOtp: approved → returns true', async () => {
      mockVerificationChecksCreate.mockResolvedValue({ status: 'approved' });
      const result = await svc.verifyPhoneOtp('+919876543210', '123456');
      expect(result).toBe(true);
      expect(mockVerificationChecksCreate).toHaveBeenCalledWith({ to: '+919876543210', code: '123456' });
    });

    it('verifyPhoneOtp: pending status → throws BadRequestError', async () => {
      mockVerificationChecksCreate.mockResolvedValue({ status: 'pending' });
      await expect(svc.verifyPhoneOtp('+919876543210', '111111')).rejects.toThrow(
        /invalid or expired otp/i
      );
    });

    it('verifyPhoneOtp: rejected status → throws BadRequestError', async () => {
      mockVerificationChecksCreate.mockResolvedValue({ status: 'rejected' });
      await expect(svc.verifyPhoneOtp('+919876543210', '000000')).rejects.toThrow(
        /invalid or expired otp/i
      );
    });

    it('verifyPhoneOtp: Twilio error 60202 (max attempts) → mapped error', async () => {
      const err = new Error('Max attempts'); err.code = 60202;
      mockVerificationChecksCreate.mockRejectedValue(err);
      await expect(svc.verifyPhoneOtp('+919876543210', '999999')).rejects.toThrow(
        /maximum check attempts/i
      );
    });

    it('verifyPhoneOtp: Twilio error 60205 (expired) → mapped error', async () => {
      const err = new Error('Expired'); err.code = 60205;
      mockVerificationChecksCreate.mockRejectedValue(err);
      await expect(svc.verifyPhoneOtp('+919876543210', '123456')).rejects.toThrow(
        /expired/i
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Simulation mode (no credentials configured)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Simulation mode (no Twilio credentials)', () => {
    let simSvc;

    beforeAll(() => {
      // Ensure config has NO credentials
      const saved = { ...config.twilio };
      config.twilio.accountSid = '';
      config.twilio.authToken = '';
      config.twilio.verifyServiceSid = '';

      const { TwilioService } = require('../src/services/twilio.service');
      simSvc = new TwilioService();

      // Restore
      Object.assign(config.twilio, saved);
    });

    it('isConfigured() returns false when no credentials', () => {
      expect(simSvc.isConfigured()).toBe(false);
    });

    it('sendPhoneOtp: returns simulated=true without calling Twilio', async () => {
      const result = await simSvc.sendPhoneOtp('+919876543210');
      expect(result.simulated).toBe(true);
      expect(result.success).toBe(true);
      expect(mockVerificationsCreate).not.toHaveBeenCalled();
    });

    it('verifyPhoneOtp: accepts any 6-digit code in simulation', async () => {
      const result = await simSvc.verifyPhoneOtp('+919876543210', '123456');
      expect(result).toBe(true);
    });

    it('verifyPhoneOtp: rejects non-6-digit code in simulation', async () => {
      await expect(simSvc.verifyPhoneOtp('+919876543210', '12')).rejects.toThrow(/invalid otp/i);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Auth endpoint integration
  //    The app uses the singleton twilioService. We spy on it directly.
  // ══════════════════════════════════════════════════════════════════════════
  describe('Auth endpoint integration (spy on singleton)', () => {
    let sendSpy, verifySpy;

    beforeEach(() => {
      // Spy on the ALREADY-LOADED singleton from the app's require cache
      const { twilioService } = require('../src/services/twilio.service');
      sendSpy = jest.spyOn(twilioService, 'sendPhoneOtp');
      verifySpy = jest.spyOn(twilioService, 'verifyPhoneOtp');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('POST /register: succeeds and calls twilioService.sendPhoneOtp', async () => {
      sendSpy.mockResolvedValue({ success: true, simulated: false });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ fullName: 'Twilio Test User', email: TEST_EMAIL, phone: TEST_PHONE, password: 'StrongPass@123', role: 'CUSTOMER' });

      expect(res.status).toBe(201);
      expect(sendSpy).toHaveBeenCalledWith(TEST_PHONE);
    });

    it('POST /verify-phone-otp: approved → marks phone verified', async () => {
      verifySpy.mockResolvedValue(true);
      await User.create({
        fullName: 'Phone Verify Test', email: TEST_EMAIL, phone: TEST_PHONE,
        passwordHash: 'dummy', role: UserRole.CUSTOMER,
        isActive: true, isEmailVerified: true, isPhoneVerified: false,
      });

      const res = await request(app)
        .post('/api/auth/verify-phone-otp')
        .send({ phone: TEST_PHONE, otp: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.data.user.isPhoneVerified).toBe(true);
      expect(verifySpy).toHaveBeenCalledWith(TEST_PHONE, '123456');
    });

    it('POST /verify-phone-otp: rejected OTP → 400', async () => {
      const { BadRequestError } = require('../src/utils/errors');
      verifySpy.mockRejectedValue(new BadRequestError('Invalid or expired OTP. Please request a new one.'));
      await User.create({
        fullName: 'Phone Reject Test', email: TEST_EMAIL, phone: TEST_PHONE,
        passwordHash: 'dummy', role: UserRole.CUSTOMER,
        isActive: true, isEmailVerified: true, isPhoneVerified: false,
      });

      const res = await request(app)
        .post('/api/auth/verify-phone-otp')
        .send({ phone: TEST_PHONE, otp: '000000' });

      expect(res.status).toBe(400);
    });

    it('POST /request-phone-login-otp: calls sendPhoneOtp when user exists', async () => {
      sendSpy.mockResolvedValue({ success: true, simulated: false });
      await User.create({
        fullName: 'Phone Login Test', email: TEST_EMAIL, phone: TEST_PHONE,
        passwordHash: 'dummy', role: UserRole.CUSTOMER,
        isActive: true, isEmailVerified: true, isPhoneVerified: true,
      });

      const res = await request(app)
        .post('/api/auth/request-phone-login-otp')
        .send({ phone: TEST_PHONE });

      expect(res.status).toBe(200);
      expect(sendSpy).toHaveBeenCalledWith(TEST_PHONE);
    });

    it('POST /request-phone-login-otp: 200 when user absent (no disclosure)', async () => {
      const res = await request(app)
        .post('/api/auth/request-phone-login-otp')
        .send({ phone: '+919999988888' });
      expect(res.status).toBe(200);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('POST /verify-phone-login-otp: approved → returns tokens', async () => {
      verifySpy.mockResolvedValue(true);
      await User.create({
        fullName: 'Phone Login Verify', email: TEST_EMAIL, phone: TEST_PHONE,
        passwordHash: 'dummy', role: UserRole.CUSTOMER,
        isActive: true, isEmailVerified: true, isPhoneVerified: true,
      });

      const res = await request(app)
        .post('/api/auth/verify-phone-login-otp')
        .send({ phone: TEST_PHONE, otp: '654321' });

      expect(res.status).toBe(200);
      expect(res.body.data.tokens.accessToken).toBeTruthy();
    });

    it('POST /verify-phone-login-otp: rejected OTP → 400', async () => {
      const { BadRequestError } = require('../src/utils/errors');
      verifySpy.mockRejectedValue(new BadRequestError('Invalid or expired OTP. Please request a new one.'));
      await User.create({
        fullName: 'Phone Login Reject', email: TEST_EMAIL, phone: TEST_PHONE,
        passwordHash: 'dummy', role: UserRole.CUSTOMER,
        isActive: true, isEmailVerified: true, isPhoneVerified: true,
      });

      const res = await request(app)
        .post('/api/auth/verify-phone-login-otp')
        .send({ phone: TEST_PHONE, otp: '000000' });

      expect(res.status).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Regression: Email OTP and password login unaffected by Twilio
  // ══════════════════════════════════════════════════════════════════════════
  describe('Regression: Email OTP & Password Login', () => {
    let sendSpy;

    beforeEach(() => {
      const { twilioService } = require('../src/services/twilio.service');
      sendSpy = jest.spyOn(twilioService, 'sendPhoneOtp');
    });

    afterEach(() => jest.restoreAllMocks());

    it('POST /request-email-login-otp: works without calling Twilio', async () => {
      await User.create({
        fullName: 'Email OTP Regression', email: TEST_EMAIL, phone: TEST_PHONE,
        passwordHash: 'dummy', role: UserRole.CUSTOMER,
        isActive: true, isEmailVerified: true, isPhoneVerified: true,
      });

      const res = await request(app)
        .post('/api/auth/request-email-login-otp')
        .send({ email: TEST_EMAIL });

      expect(res.status).toBe(200);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('POST /login (password): works without calling Twilio', async () => {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('StrongPass@123', 12);
      await User.create({
        fullName: 'Password Login Regression', email: TEST_EMAIL, phone: TEST_PHONE,
        passwordHash: hash, role: UserRole.CUSTOMER,
        isActive: true, isEmailVerified: true, isPhoneVerified: true,
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: TEST_EMAIL, password: 'StrongPass@123' });

      expect(res.status).toBe(200);
      expect(res.body.data.tokens.accessToken).toBeTruthy();
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });
});
