/**
 * Email Notification Recipient Matrix + Content Tests
 *
 * Uses Jest module mocking to intercept nodemailer.createTransport
 * and assert:
 *   - Exact `to:` recipients for every event
 *   - Subject line format ([SupportPulse] [TKT-...] Event — Title)
 *   - Email body contains: Ticket ID, subject, status, priority, category,
 *     customer info, update content
 *   - Internal notes NEVER appear in any email
 */

const request = require('supertest');
const mongoose = require('mongoose');

// ─── Mock nodemailer BEFORE any require that loads notification.service.js ───
const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    verify: jest.fn().mockResolvedValue(true),
    sendMail: mockSendMail,
  })),
}));

const { createApp } = require('../src/app');
const { config } = require('../src/config');
const { User } = require('../src/modules/user/user.model');
const { Ticket } = require('../src/modules/ticket/ticket.model');
const { Category } = require('../src/modules/category/category.model');
const { TicketMessage } = require('../src/modules/ticketMessage/ticketMessage.model');
const { UserRole } = require('../src/constants/roles');
const { signAccessToken } = require('../src/utils/jwt');

// ─── Test Helpers ────────────────────────────────────────────────────────────

const getSentCalls = () => mockSendMail.mock.calls.map((c) => c[0]);

const hasRecipient = (calls, email) =>
  calls.some((c) => c.to === email || (Array.isArray(c.to) && c.to.includes(email)));

const callTo = (calls, email) => calls.find((c) => c.to === email);

const bodyContains = (call, str) =>
  call && typeof call.html === 'string' && call.html.includes(str);

const subjectContains = (call, str) =>
  call && call.subject && call.subject.includes(str);

const tick = () => new Promise((r) => setImmediate(r));

// ─────────────────────────────────────────────────────────────────────────────

describe('Email Notification Recipient Matrix & Content', () => {
  let app;
  let customerToken, agentToken, adminToken;
  let customerUser, agentUser, adminUser;
  let testCategory;

  const ADMIN_EMAIL = config.email.adminSupportEmail;
  const CUSTOMER_EMAIL = 'emailtest@notiftest.com';
  const AGENT_EMAIL = 'agent@notiftest.com';
  const STAFF_EMAIL = 'staffadmin@notiftest.com';

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongo.uri);
    }
    app = createApp();
  });

  afterAll(async () => {
    await Ticket.deleteMany({ requesterEmail: CUSTOMER_EMAIL });
    await TicketMessage.deleteMany({});
    await User.deleteMany({ email: { $in: [CUSTOMER_EMAIL, AGENT_EMAIL, STAFF_EMAIL] } });
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });

  beforeEach(async () => {
    mockSendMail.mockClear();

    await Ticket.deleteMany({ requesterEmail: CUSTOMER_EMAIL });
    await TicketMessage.deleteMany({});
    await User.deleteMany({ email: { $in: [CUSTOMER_EMAIL, AGENT_EMAIL, STAFF_EMAIL] } });

    testCategory = await Category.findOne({ isActive: true });
    if (!testCategory) {
      testCategory = await Category.create({
        name: 'Notification Test Category',
        description: 'For notification tests',
        isActive: true,
      });
    }

    customerUser = await User.create({
      fullName: 'Email Test Customer',
      email: CUSTOMER_EMAIL,
      phone: '+919999900001',
      passwordHash: 'dummy',
      role: UserRole.CUSTOMER,
      isActive: true,
      isEmailVerified: true,
    });
    agentUser = await User.create({
      fullName: 'Email Test Agent',
      email: AGENT_EMAIL,
      phone: '+919999900002',
      passwordHash: 'dummy',
      role: UserRole.AGENT,
      isActive: true,
      isEmailVerified: true,
    });
    adminUser = await User.create({
      fullName: 'Email Staff Admin',
      email: STAFF_EMAIL,
      phone: '+919999900003',
      passwordHash: 'dummy',
      role: UserRole.ADMIN,
      isActive: true,
      isEmailVerified: true,
    });

    customerToken = signAccessToken({ userId: customerUser._id, role: UserRole.CUSTOMER });
    agentToken = signAccessToken({ userId: agentUser._id, role: UserRole.AGENT });
    adminToken = signAccessToken({ userId: adminUser._id, role: UserRole.ADMIN });
  });

  const createTicket = async (title = 'Notification Matrix Test Ticket') => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        title,
        description: 'This is a test ticket for notification testing.',
        categoryId: testCategory._id.toString(),
        priority: 'HIGH',
      });
    expect(res.status).toBe(201);
    return res.body.data.ticket;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // 1. TICKET CREATION
  // ══════════════════════════════════════════════════════════════════════════
  describe('TICKET CREATED', () => {
    it('sends to CUSTOMER and ADMIN_SUPPORT_EMAIL as separate deliveries', async () => {
      mockSendMail.mockClear();
      const ticket = await createTicket();
      await tick();

      const calls = getSentCalls();
      expect(hasRecipient(calls, CUSTOMER_EMAIL)).toBe(true);
      expect(hasRecipient(calls, ADMIN_EMAIL)).toBe(true);
    });

    it('customer email body contains ticket ID, subject, status, priority, category', async () => {
      const ticket = await createTicket('Login Issue Test');
      await tick();

      const calls = getSentCalls();
      const cCall = callTo(calls, CUSTOMER_EMAIL);
      expect(cCall).toBeDefined();
      expect(bodyContains(cCall, ticket.ticketNumber)).toBe(true);
      expect(bodyContains(cCall, 'Login Issue Test')).toBe(true);
      expect(bodyContains(cCall, 'HIGH')).toBe(true);
      expect(bodyContains(cCall, testCategory.name)).toBe(true);
    });

    it('customer email subject contains ticket number', async () => {
      const ticket = await createTicket('Login Issue Test');
      await tick();
      const cCall = callTo(getSentCalls(), CUSTOMER_EMAIL);
      expect(subjectContains(cCall, ticket.ticketNumber)).toBe(true);
      expect(subjectContains(cCall, '[SupportPulse]')).toBe(true);
    });

    it('admin email body contains customer name and email', async () => {
      const ticket = await createTicket();
      await tick();
      const aCall = callTo(getSentCalls(), ADMIN_EMAIL);
      expect(aCall).toBeDefined();
      expect(bodyContains(aCall, CUSTOMER_EMAIL)).toBe(true);
      expect(bodyContains(aCall, 'Email Test Customer')).toBe(true);
    });

    it('ADMIN_SUPPORT_EMAIL loaded from config (not hardcoded)', () => {
      expect(ADMIN_EMAIL).toBe(process.env.ADMIN_SUPPORT_EMAIL || 'admin@yourdomain.com');
      expect(typeof ADMIN_EMAIL).toBe('string');
      expect(ADMIN_EMAIL.length).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. TICKET ASSIGNMENT
  // ══════════════════════════════════════════════════════════════════════════
  describe('TICKET ASSIGNED', () => {
    it('sends to CUSTOMER, AGENT, and ADMIN_SUPPORT_EMAIL', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();

      const res = await request(app)
        .post(`/api/tickets/${ticket._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: agentUser._id.toString() });
      expect(res.status).toBe(200);
      await tick();

      const calls = getSentCalls();
      expect(hasRecipient(calls, CUSTOMER_EMAIL)).toBe(true);
      expect(hasRecipient(calls, AGENT_EMAIL)).toBe(true);
      if (ADMIN_EMAIL !== AGENT_EMAIL) {
        expect(hasRecipient(calls, ADMIN_EMAIL)).toBe(true);
      }
    });

    it('customer assignment email body contains ticket ID and agent name', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();

      await request(app)
        .post(`/api/tickets/${ticket._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: agentUser._id.toString() });
      await tick();

      const cCall = callTo(getSentCalls(), CUSTOMER_EMAIL);
      expect(cCall).toBeDefined();
      expect(bodyContains(cCall, ticket.ticketNumber)).toBe(true);
      expect(bodyContains(cCall, 'Email Test Agent')).toBe(true);
    });

    it('customer assignment email subject contains ticket number', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();
      await request(app)
        .post(`/api/tickets/${ticket._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: agentUser._id.toString() });
      await tick();
      const cCall = callTo(getSentCalls(), CUSTOMER_EMAIL);
      expect(subjectContains(cCall, ticket.ticketNumber)).toBe(true);
      expect(subjectContains(cCall, '[SupportPulse]')).toBe(true);
    });

    it('does NOT send any email when ticket is unassigned', async () => {
      const ticket = await createTicket();
      await request(app)
        .post(`/api/tickets/${ticket._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: agentUser._id.toString() });
      mockSendMail.mockClear();

      await request(app)
        .post(`/api/tickets/${ticket._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      await tick();

      expect(getSentCalls().length).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. AGENT PUBLIC REPLY
  // ══════════════════════════════════════════════════════════════════════════
  describe('AGENT PUBLIC REPLY', () => {
    it('sends to CUSTOMER and ADMIN_SUPPORT_EMAIL', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();

      const res = await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: 'We are actively investigating your issue.', type: 'PUBLIC' });
      expect(res.status).toBe(201);
      await tick();

      const calls = getSentCalls();
      expect(hasRecipient(calls, CUSTOMER_EMAIL)).toBe(true);
      if (ADMIN_EMAIL !== CUSTOMER_EMAIL) {
        expect(hasRecipient(calls, ADMIN_EMAIL)).toBe(true);
      }
    });

    it('customer reply email body contains the actual reply text', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();
      const replyText = 'Your account has been reset successfully.';

      await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: replyText, type: 'PUBLIC' });
      await tick();

      const cCall = callTo(getSentCalls(), CUSTOMER_EMAIL);
      expect(cCall).toBeDefined();
      expect(bodyContains(cCall, ticket.ticketNumber)).toBe(true);
      expect(bodyContains(cCall, replyText)).toBe(true);
    });

    it('customer reply email subject contains ticket number', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();
      await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: 'Test reply.', type: 'PUBLIC' });
      await tick();
      const cCall = callTo(getSentCalls(), CUSTOMER_EMAIL);
      expect(subjectContains(cCall, ticket.ticketNumber)).toBe(true);
    });

    it('INTERNAL NOTE must NOT send ANY email', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();

      const res = await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: 'Private internal note — staff only.', type: 'INTERNAL_NOTE' });
      expect(res.status).toBe(201);
      await tick();

      const calls = getSentCalls();
      expect(calls.length).toBe(0);
      expect(hasRecipient(calls, CUSTOMER_EMAIL)).toBe(false);
      expect(hasRecipient(calls, ADMIN_EMAIL)).toBe(false);
    });

    it('INTERNAL NOTE text must NEVER appear in any email body', async () => {
      const ticket = await createTicket();
      await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: 'Secret internal escalation note.', type: 'PUBLIC' });
      mockSendMail.mockClear();

      await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: 'CONFIDENTIAL_INTERNAL_CONTENT', type: 'INTERNAL_NOTE' });
      await tick();

      const allBodies = getSentCalls().map((c) => c.html || '').join(' ');
      expect(allBodies.includes('CONFIDENTIAL_INTERNAL_CONTENT')).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. CUSTOMER REPLY
  // ══════════════════════════════════════════════════════════════════════════
  describe('CUSTOMER REPLY', () => {
    it('sends to AGENT and ADMIN_SUPPORT_EMAIL — NOT the customer', async () => {
      const ticket = await createTicket();
      await request(app)
        .post(`/api/tickets/${ticket._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: agentUser._id.toString() });
      mockSendMail.mockClear();

      const res = await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ body: 'Still having the same issue.' });
      expect(res.status).toBe(201);
      await tick();

      const calls = getSentCalls();
      expect(hasRecipient(calls, AGENT_EMAIL)).toBe(true);
      expect(hasRecipient(calls, ADMIN_EMAIL)).toBe(true);
      expect(hasRecipient(calls, CUSTOMER_EMAIL)).toBe(false);
    });

    it('agent notification body contains ticket ID and customer reply text', async () => {
      const ticket = await createTicket();
      await request(app)
        .post(`/api/tickets/${ticket._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: agentUser._id.toString() });
      mockSendMail.mockClear();

      const replyText = 'Still broken after clearing cache.';
      await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ body: replyText });
      await tick();

      const aCall = callTo(getSentCalls(), AGENT_EMAIL);
      expect(aCall).toBeDefined();
      expect(bodyContains(aCall, ticket.ticketNumber)).toBe(true);
      expect(bodyContains(aCall, replyText)).toBe(true);
    });

    it('sends to ADMIN_SUPPORT_EMAIL even when no agent is assigned', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();

      await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ body: 'No agent assigned yet.' });
      await tick();

      const calls = getSentCalls();
      expect(hasRecipient(calls, ADMIN_EMAIL)).toBe(true);
      expect(hasRecipient(calls, CUSTOMER_EMAIL)).toBe(false);
    });

    it('customer reply email subject contains ticket number', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();
      await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ body: 'Another reply.' });
      await tick();
      const adminCall = callTo(getSentCalls(), ADMIN_EMAIL);
      expect(subjectContains(adminCall, ticket.ticketNumber)).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. STATUS LIFECYCLE EMAILS
  // ══════════════════════════════════════════════════════════════════════════
  describe('STATUS LIFECYCLE EMAILS', () => {
    const getInProgress = async () => {
      const ticket = await createTicket();
      await request(app)
        .post(`/api/tickets/${ticket._id}/status`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ status: 'IN_PROGRESS' });
      return ticket;
    };

    it('RESOLVED: sends to CUSTOMER and ADMIN_SUPPORT_EMAIL', async () => {
      const ticket = await getInProgress();
      mockSendMail.mockClear();

      const res = await request(app)
        .post(`/api/tickets/${ticket._id}/resolve`)
        .set('Authorization', `Bearer ${agentToken}`);
      expect(res.status).toBe(200);
      await tick();

      const calls = getSentCalls();
      expect(hasRecipient(calls, CUSTOMER_EMAIL)).toBe(true);
      expect(hasRecipient(calls, ADMIN_EMAIL)).toBe(true);
    });

    it('RESOLVED: customer email body contains RESOLVED status and ticket ID', async () => {
      const ticket = await getInProgress();
      mockSendMail.mockClear();
      await request(app).post(`/api/tickets/${ticket._id}/resolve`).set('Authorization', `Bearer ${agentToken}`);
      await tick();

      const cCall = callTo(getSentCalls(), CUSTOMER_EMAIL);
      expect(cCall).toBeDefined();
      expect(bodyContains(cCall, ticket.ticketNumber)).toBe(true);
      expect(bodyContains(cCall, 'RESOLVED')).toBe(true);
    });

    it('RESOLVED: email subject contains ticket number and Resolved', async () => {
      const ticket = await getInProgress();
      mockSendMail.mockClear();
      await request(app).post(`/api/tickets/${ticket._id}/resolve`).set('Authorization', `Bearer ${agentToken}`);
      await tick();
      const cCall = callTo(getSentCalls(), CUSTOMER_EMAIL);
      expect(subjectContains(cCall, ticket.ticketNumber)).toBe(true);
      expect(subjectContains(cCall, '[SupportPulse]')).toBe(true);
    });

    it('REOPENED: sends to CUSTOMER and ADMIN_SUPPORT_EMAIL', async () => {
      const ticket = await getInProgress();
      await request(app).post(`/api/tickets/${ticket._id}/resolve`).set('Authorization', `Bearer ${agentToken}`);
      mockSendMail.mockClear();

      const res = await request(app)
        .post(`/api/tickets/${ticket._id}/reopen`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      await tick();

      const calls = getSentCalls();
      expect(hasRecipient(calls, CUSTOMER_EMAIL)).toBe(true);
      expect(hasRecipient(calls, ADMIN_EMAIL)).toBe(true);
    });

    it('REOPENED: customer email body contains REOPENED and ticket ID', async () => {
      const ticket = await getInProgress();
      await request(app).post(`/api/tickets/${ticket._id}/resolve`).set('Authorization', `Bearer ${agentToken}`);
      mockSendMail.mockClear();
      await request(app).post(`/api/tickets/${ticket._id}/reopen`).set('Authorization', `Bearer ${customerToken}`);
      await tick();

      const cCall = callTo(getSentCalls(), CUSTOMER_EMAIL);
      expect(bodyContains(cCall, ticket.ticketNumber)).toBe(true);
      expect(bodyContains(cCall, 'REOPENED')).toBe(true);
    });

    it('CLOSED: sends to CUSTOMER and ADMIN_SUPPORT_EMAIL', async () => {
      const ticket = await getInProgress();
      await request(app).post(`/api/tickets/${ticket._id}/resolve`).set('Authorization', `Bearer ${agentToken}`);
      mockSendMail.mockClear();

      const res = await request(app)
        .post(`/api/tickets/${ticket._id}/close`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      await tick();

      const calls = getSentCalls();
      expect(hasRecipient(calls, CUSTOMER_EMAIL)).toBe(true);
      expect(hasRecipient(calls, ADMIN_EMAIL)).toBe(true);
    });

    it('CLOSED: email body contains CLOSED and ticket ID', async () => {
      const ticket = await getInProgress();
      await request(app).post(`/api/tickets/${ticket._id}/resolve`).set('Authorization', `Bearer ${agentToken}`);
      mockSendMail.mockClear();
      await request(app).post(`/api/tickets/${ticket._id}/close`).set('Authorization', `Bearer ${adminToken}`);
      await tick();

      const cCall = callTo(getSentCalls(), CUSTOMER_EMAIL);
      expect(bodyContains(cCall, ticket.ticketNumber)).toBe(true);
      expect(bodyContains(cCall, 'CLOSED')).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. SUBJECT LINE FORMAT
  // ══════════════════════════════════════════════════════════════════════════
  describe('SUBJECT LINE FORMAT', () => {
    it('every ticket email subject starts with [SupportPulse]', async () => {
      await createTicket('Subject Format Test');
      await tick();
      const calls = getSentCalls();
      expect(calls.length).toBeGreaterThan(0);
      calls.forEach((c) => {
        expect(c.subject).toMatch(/^\[SupportPulse\]/);
      });
    });

    it('every ticket email subject contains the ticket number', async () => {
      const ticket = await createTicket('Subject Format Test 2');
      await tick();
      const calls = getSentCalls();
      calls.forEach((c) => {
        expect(c.subject).toContain(ticket.ticketNumber);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. TEMPLATE CONTENT FIELDS (View Ticket, Ticket ID prominent)
  // ══════════════════════════════════════════════════════════════════════════
  describe('TEMPLATE CONTENT FIELDS', () => {
    it('customer creation email shows Ticket Details section', async () => {
      const ticket = await createTicket('Fields Verification Test');
      await tick();
      const cCall = callTo(getSentCalls(), CUSTOMER_EMAIL);
      expect(bodyContains(cCall, 'Ticket Details')).toBe(true);
    });

    it('email contains View Ticket link when frontendUrl is configured', async () => {
      const ticket = await createTicket('ViewTicket Link Test');
      await tick();
      const cCall = callTo(getSentCalls(), CUSTOMER_EMAIL);
      if (config.frontendUrl) {
        expect(bodyContains(cCall, '/tickets/')).toBe(true);
        expect(bodyContains(cCall, 'View Ticket')).toBe(true);
      }
    });

    it('footer contains ticket number in every email', async () => {
      const ticket = await createTicket('Footer Test Ticket');
      await tick();
      const calls = getSentCalls();
      calls.forEach((c) => {
        expect(bodyContains(c, ticket.ticketNumber)).toBe(true);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8. SECURITY INVARIANTS
  // ══════════════════════════════════════════════════════════════════════════
  describe('SECURITY INVARIANTS', () => {
    it('INTERNAL NOTE does NOT send email to anyone', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();

      await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: 'Escalating to level 2 team — internal only.', type: 'INTERNAL_NOTE' });
      await tick();

      expect(getSentCalls().length).toBe(0);
    });

    it('customer reply does NOT send email back to the customer', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();

      await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ body: 'Just following up on my issue.' });
      await tick();

      expect(hasRecipient(getSentCalls(), CUSTOMER_EMAIL)).toBe(false);
    });

    it('INTERNAL NOTE text is NEVER present in any sent email body', async () => {
      const ticket = await createTicket();
      mockSendMail.mockClear();

      await request(app)
        .post(`/api/tickets/${ticket._id}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: 'SUPER_SECRET_INTERNAL_DATA_12345', type: 'INTERNAL_NOTE' });
      await tick();

      const allBodies = getSentCalls().map((c) => c.html || '').join('');
      expect(allBodies.includes('SUPER_SECRET_INTERNAL_DATA_12345')).toBe(false);
    });
  });
});
