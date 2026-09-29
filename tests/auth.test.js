const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../src/app');
const { config } = require('../src/config');
const { User } = require('../src/modules/user/user.model');
const { Otp } = require('../src/modules/otp/otp.model');
const { UserRole } = require('../src/constants/roles');
const { OtpPurpose } = require('../src/constants/otp');
const { otpService } = require('../src/modules/otp/otp.service');
const { notificationService } = require('../src/services/notification.service');
const { twilioService } = require('../src/services/twilio.service');
const { signAccessToken } = require('../src/utils/jwt');

describe('Authentication & RBAC Test Suite', () => {
  let app;

  beforeAll(async () => {
    // Connect to test database first (needed before createApp)
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongo.uri);
    }

    // Mock all external services BEFORE creating the app so every call during
    // registration, OTP flows, etc. is intercepted — including fire-and-forget ones.
    jest.spyOn(notificationService, 'sendEmailOtp').mockResolvedValue(true);
    jest.spyOn(notificationService, 'sendPhoneOtp').mockResolvedValue(true);

    // Mock Twilio so phone OTP tests never hit the real Twilio Verify API.
    // sendPhoneOtp: always succeeds; verifyPhoneOtp: accepts any code.
    jest.spyOn(twilioService, 'sendPhoneOtp').mockResolvedValue({ success: true, simulated: true });
    jest.spyOn(twilioService, 'verifyPhoneOtp').mockResolvedValue(true);

    app = createApp();
  });

  beforeEach(async () => {
    // Clean up test data
    await User.deleteMany({ email: /.*@test\.com$/ });
    await Otp.deleteMany({ identifier: /.*test.*/ });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await User.deleteMany({ email: /.*@test\.com$/ });
    await Otp.deleteMany({ identifier: /.*test.*/ });
    await mongoose.disconnect();
  });


  const validUserData = {
    fullName: 'Test Customer',
    email: 'customer@test.com',
    phone: '+919999988888',
    password: 'StrongPassword123#',
  };

  // 1. Registration
  describe('POST /api/auth/register', () => {
    it('should register a new customer user successfully', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send(validUserData);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe(validUserData.email);
      expect(res.body.data.user.role).toBe(UserRole.CUSTOMER);
      expect(res.body.data.user.passwordHash).toBeUndefined();

      // Check user saved in database
      const dbUser = await User.findOne({ email: validUserData.email });
      expect(dbUser).toBeDefined();
      expect(dbUser.isEmailVerified).toBe(false);
      expect(dbUser.isPhoneVerified).toBe(false);
    });

    it('should reject duplicate email registration with 409 Conflict', async () => {
      await request(app).post('/api/auth/register').send(validUserData);

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          ...validUserData,
          phone: '+919999977777', // different phone
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('should reject duplicate phone registration with 409 Conflict', async () => {
      await request(app).post('/api/auth/register').send(validUserData);

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          ...validUserData,
          email: 'different@test.com',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/phone number already exists/i);
    });

    it('should reject registration with weak password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          ...validUserData,
          password: 'weak',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toBeDefined();
    });

    it('should allow public user to select their role during registration', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          ...validUserData,
          role: 'ADMIN',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.user.role).toBe(UserRole.ADMIN);

      const dbUser = await User.findOne({ email: validUserData.email });
      expect(dbUser.role).toBe(UserRole.ADMIN);
    });
  });

  // 2. Email & Phone OTP Verification
  describe('OTP Verifications', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(validUserData);
    });

    it('should verify email successfully with valid OTP', async () => {
      // Generate known OTP with skipCooldown for testing
      const otpObj = await otpService.generateOtp(validUserData.email, OtpPurpose.EMAIL_VERIFICATION, { skipCooldown: true });

      const res = await request(app)
        .post('/api/auth/verify-email-otp')
        .send({
          email: validUserData.email,
          otp: otpObj.otp,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbUser = await User.findOne({ email: validUserData.email });
      expect(dbUser.isEmailVerified).toBe(true);
    });

    it('should reject email verification with incorrect OTP', async () => {
      await otpService.generateOtp(validUserData.email, OtpPurpose.EMAIL_VERIFICATION, { skipCooldown: true });

      const res = await request(app)
        .post('/api/auth/verify-email-otp')
        .send({
          email: validUserData.email,
          otp: '000000',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid OTP/i);
    });

    it('should verify phone successfully with valid OTP', async () => {
      // twilioService is mocked in beforeAll to accept any code — no real Twilio call.
      const res = await request(app)
        .post('/api/auth/verify-phone-otp')
        .send({
          phone: validUserData.phone,
          otp: '123456', // any 6-digit code; mock always returns true
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbUser = await User.findOne({ phone: validUserData.phone });
      expect(dbUser.isPhoneVerified).toBe(true);
    });

    it('should enforce cooldown when resending OTP rapidly', async () => {
      // Generate initial OTP
      await otpService.generateOtp(validUserData.email, OtpPurpose.EMAIL_VERIFICATION, { skipCooldown: true });

      // Immediate resend via API should trigger cooldown
      const res = await request(app)
        .post('/api/auth/resend-otp')
        .send({
          identifier: validUserData.email,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Please wait/i);
    });
  });

  // 3. Password Login & Account Lockout
  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(validUserData);
    });

    it('should log in successfully with valid credentials and return tokens', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: validUserData.email,
          password: validUserData.password,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tokens).toBeDefined();
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.tokens.refreshToken).toBeDefined();
      expect(res.body.data.user.email).toBe(validUserData.email);
    });

    it('should reject login with wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: validUserData.email,
          password: 'WrongPassword123#',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid email or password/i);
    });

    it('should temporarily lock account after 5 failed login attempts', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({ email: validUserData.email, password: 'WrongPassword123#' });
      }

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: validUserData.email, password: validUserData.password });

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Account is temporarily locked/i);
    });
  });

  // 4. Passwordless Login via Email & Phone OTP
  describe('Passwordless OTP Logins', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(validUserData);
    });

    it('should log in via Email OTP successfully', async () => {
      // Request OTP
      const reqRes = await request(app)
        .post('/api/auth/request-email-login-otp')
        .send({ email: validUserData.email });
      expect(reqRes.status).toBe(200);

      // Verify OTP
      const otpObj = await otpService.generateOtp(validUserData.email, OtpPurpose.EMAIL_LOGIN, { skipCooldown: true });
      const verifyRes = await request(app)
        .post('/api/auth/verify-email-login-otp')
        .send({ email: validUserData.email, otp: otpObj.otp });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.tokens).toBeDefined();
      expect(verifyRes.body.data.tokens.accessToken).toBeDefined();
    });

    it('should log in via Phone OTP successfully', async () => {
      // Request OTP — calls twilioService.sendPhoneOtp (mocked)
      const reqRes = await request(app)
        .post('/api/auth/request-phone-login-otp')
        .send({ phone: validUserData.phone });
      expect(reqRes.status).toBe(200);

      // Verify OTP — calls twilioService.verifyPhoneOtp (mocked, always true)
      const verifyRes = await request(app)
        .post('/api/auth/verify-phone-login-otp')
        .send({ phone: validUserData.phone, otp: '654321' });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.tokens).toBeDefined();
    });
  });

  // 5. Forgot & Reset Password
  describe('Password Reset Flow', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(validUserData);
    });

    it('should complete password reset with OTP successfully', async () => {
      // Request forgot password
      const forgotRes = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: validUserData.email });
      expect(forgotRes.status).toBe(200);

      // Generate known OTP
      const otpObj = await otpService.generateOtp(validUserData.email, OtpPurpose.PASSWORD_RESET, { skipCooldown: true });
      const newPassword = 'BrandNewPassword123#';

      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .send({
          email: validUserData.email,
          otp: otpObj.otp,
          newPassword,
        });

      expect(resetRes.status).toBe(200);

      // Verify can login with new password
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: validUserData.email,
          password: newPassword,
        });

      expect(loginRes.status).toBe(200);
    });
  });

  // 6. Token Refresh & Rotation
  describe('POST /api/auth/refresh', () => {
    it('should refresh tokens and rotate refresh token', async () => {
      await request(app).post('/api/auth/register').send(validUserData);
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: validUserData.email, password: validUserData.password });

      const oldRefreshToken = loginRes.body.data.tokens.refreshToken;

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: oldRefreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.accessToken).toBeDefined();
      expect(refreshRes.body.data.refreshToken).toBeDefined();
      expect(refreshRes.body.data.refreshToken).not.toBe(oldRefreshToken);

      // Old refresh token must be invalidated (reuse detection)
      const reusedRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: oldRefreshToken });

      expect(reusedRes.status).toBe(401);
    });
  });

  // 7. Protected Route & RBAC Authorization
  describe('RBAC & Protected Routes', () => {
    let customerToken;
    let agentToken;
    let adminToken;

    beforeEach(async () => {
      // Create Customer
      const cust = await User.create({
        ...validUserData,
        passwordHash: 'dummy',
        role: UserRole.CUSTOMER,
      });
      customerToken = signAccessToken({ userId: cust._id.toString(), role: UserRole.CUSTOMER });

      // Create Agent
      const agent = await User.create({
        ...validUserData,
        email: 'agent@test.com',
        phone: '+919999966666',
        passwordHash: 'dummy',
        role: UserRole.AGENT,
      });
      agentToken = signAccessToken({ userId: agent._id.toString(), role: UserRole.AGENT });

      // Create Admin
      const admin = await User.create({
        ...validUserData,
        email: 'admin@test.com',
        phone: '+919999955555',
        passwordHash: 'dummy',
        role: UserRole.ADMIN,
      });
      adminToken = signAccessToken({ userId: admin._id.toString(), role: UserRole.ADMIN });
    });

    it('should authenticate user on GET /api/auth/me', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(validUserData.email);
    });

    it('should reject unauthenticated request on GET /api/auth/me', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('should reject invalid or tampered access token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.tampered.token');
      expect(res.status).toBe(401);
    });
  });
});
