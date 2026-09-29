const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../src/app');
const { config } = require('../src/config');
const { User } = require('../src/modules/user/user.model');
const { Ticket } = require('../src/modules/ticket/ticket.model');
const { Category } = require('../src/modules/category/category.model');
const { TicketMessage } = require('../src/modules/ticketMessage/ticketMessage.model');
const { Counter } = require('../src/modules/ticket/counter.model');
const { UserRole } = require('../src/constants/roles');
const { TicketStatus, TicketPriority } = require('../src/constants/ticket');
const { signAccessToken } = require('../src/utils/jwt');

describe('Ticket Core Backend Test Suite', () => {
  let app;
  let customerToken, agentToken, adminToken;
  let customerUser, agentUser, adminUser;
  let testCategory;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongo.uri);
    }
    app = createApp();
  });

  beforeEach(async () => {
    // Clean test data
    await Ticket.deleteMany({ requesterEmail: /.*@tickettest\.com$/ });
    await TicketMessage.deleteMany({});
    await User.deleteMany({ email: /.*@tickettest\.com$/ });
    await Category.deleteMany({ name: /.*(Admin Test|Updated Admin|Customer Category|Agent Category).*/ });

    // Create or reuse test category
    testCategory = await Category.findOne({ name: 'Test Category' });
    if (!testCategory) {
      testCategory = await Category.create({
        name: 'Test Category',
        description: 'Category for automated tests',
        isActive: true,
      });
    }

    // Create test users
    customerUser = await User.create({
      fullName: 'Test Customer',
      email: 'customer@tickettest.com',
      phone: '+918888800001',
      passwordHash: 'dummy_hash',
      role: UserRole.CUSTOMER,
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    });
    customerToken = signAccessToken({ userId: customerUser._id.toString(), role: UserRole.CUSTOMER });

    agentUser = await User.create({
      fullName: 'Test Agent',
      email: 'agent@tickettest.com',
      phone: '+918888800002',
      passwordHash: 'dummy_hash',
      role: UserRole.AGENT,
      isEmailVerified: true,
      isActive: true,
    });
    agentToken = signAccessToken({ userId: agentUser._id.toString(), role: UserRole.AGENT });

    adminUser = await User.create({
      fullName: 'Test Admin',
      email: 'admin@tickettest.com',
      phone: '+918888800003',
      passwordHash: 'dummy_hash',
      role: UserRole.ADMIN,
      isEmailVerified: true,
      isActive: true,
    });
    adminToken = signAccessToken({ userId: adminUser._id.toString(), role: UserRole.ADMIN });
  });

  afterEach(async () => {
    await Ticket.deleteMany({ requesterEmail: /.*@tickettest\.com$/ });
    await TicketMessage.deleteMany({});
    await User.deleteMany({ email: /.*@tickettest\.com$/ });
    await Category.deleteMany({ name: /.*(Admin Test|Updated Admin|Customer Category|Agent Category).*/ });
  });

  afterAll(async () => {
    await Ticket.deleteMany({ requesterEmail: /.*@tickettest\.com$/ });
    await TicketMessage.deleteMany({});
    await User.deleteMany({ email: /.*@tickettest\.com$/ });
    await Category.deleteMany({ name: /.*(Admin Test|Updated Admin|Customer Category|Agent Category).*/ });
    await mongoose.disconnect();
  });

  // ============================================================
  // Helper to create a ticket via API
  // ============================================================
  const createTicketViaApi = async (token, overrides = {}) => {
    return request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Test ticket subject',
        description: 'This is a test ticket description that is long enough.',
        categoryId: testCategory._id.toString(),
        priority: TicketPriority.MEDIUM,
        ...overrides,
      });
  };

  // ============================================================
  // 1. POST /api/tickets — Create Ticket
  // ============================================================
  describe('POST /api/tickets — Create Ticket', () => {
    it('should allow authenticated customer to create a ticket', async () => {
      const res = await createTicketViaApi(customerToken);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ticket).toBeDefined();
      expect(res.body.data.ticket.requesterId).toBeDefined();
      expect(res.body.data.ticket.status).toBe(TicketStatus.OPEN);
    });

    it('should return 401 for unauthenticated request', async () => {
      const res = await request(app).post('/api/tickets').send({
        title: 'Unauthenticated ticket',
        description: 'Should fail because no token provided.',
        categoryId: testCategory._id.toString(),
      });
      expect(res.status).toBe(401);
    });

    it('should generate a unique ticket number in format TKT-YYYY-XXXXXX', async () => {
      const res = await createTicketViaApi(customerToken);
      expect(res.status).toBe(201);
      const ticketNumber = res.body.data.ticket.ticketNumber;
      expect(ticketNumber).toMatch(/^TKT-\d{4}-\d{6}$/);
    });

    it('should generate unique ticket numbers for concurrent tickets', async () => {
      const [res1, res2] = await Promise.all([
        createTicketViaApi(customerToken),
        createTicketViaApi(customerToken),
      ]);
      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      const num1 = res1.body.data.ticket.ticketNumber;
      const num2 = res2.body.data.ticket.ticketNumber;
      expect(num1).not.toBe(num2);
    });

    it('should always set requester from JWT, not from request body', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          title: 'Test ticket',
          description: 'Test description long enough to pass validation.',
          categoryId: testCategory._id.toString(),
          requesterId: adminUser._id.toString(), // attacker tries to spoof requester
        });
      expect(res.status).toBe(201);
      // requesterId is populated by the controller; compare the nested _id
      const returnedRequesterId =
        res.body.data.ticket.requesterId?._id ?? res.body.data.ticket.requesterId;
      expect(returnedRequesterId.toString()).toBe(customerUser._id.toString());
    });

    it('should return 422 with missing required fields', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ title: 'No description or category' });
      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('should return 422 when title is too short', async () => {
      const res = await createTicketViaApi(customerToken, { title: 'Hi' });
      expect(res.status).toBe(422);
    });

    it('should return 404 when category does not exist', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await createTicketViaApi(customerToken, { categoryId: fakeId });
      expect(res.status).toBe(404);
    });

    it('should default priority to MEDIUM if not provided', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          title: 'Ticket without priority',
          description: 'Description is here and long enough to pass.',
          categoryId: testCategory._id.toString(),
        });
      expect(res.status).toBe(201);
      expect(res.body.data.ticket.priority).toBe(TicketPriority.MEDIUM);
    });

    it('should allow agent to create a ticket', async () => {
      const res = await createTicketViaApi(agentToken);
      expect(res.status).toBe(201);
    });

    it('should allow admin to create a ticket', async () => {
      const res = await createTicketViaApi(adminToken);
      expect(res.status).toBe(201);
    });
  });

  // ============================================================
  // 2. GET /api/tickets — List Tickets
  // ============================================================
  describe('GET /api/tickets — List Tickets', () => {
    beforeEach(async () => {
      // Customer ticket
      await createTicketViaApi(customerToken);

      // Another customer's ticket
      const otherCustomer = await User.create({
        fullName: 'Other Customer',
        email: 'other@tickettest.com',
        phone: '+918888800099',
        passwordHash: 'dummy_hash',
        role: UserRole.CUSTOMER,
        isActive: true,
      });
      const otherToken = signAccessToken({ userId: otherCustomer._id.toString(), role: UserRole.CUSTOMER });
      await createTicketViaApi(otherToken);
    });

    it('should return 401 for unauthenticated request', async () => {
      const res = await request(app).get('/api/tickets');
      expect(res.status).toBe(401);
    });

    it('should return only the customer\'s own tickets', async () => {
      const res = await request(app)
        .get('/api/tickets')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      const tickets = res.body.data.tickets;
      expect(Array.isArray(tickets)).toBe(true);
      tickets.forEach((t) => {
        expect(t.requesterEmail).toBe('customer@tickettest.com');
      });
    });

    it('should return all tickets for admin', async () => {
      const res = await request(app)
        .get('/api/tickets')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBeGreaterThanOrEqual(2);
    });

    it('should support pagination', async () => {
      const res = await request(app)
        .get('/api/tickets?page=1&limit=1')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBe(1);
      expect(res.body.data.totalPages).toBeGreaterThanOrEqual(1);
    });

    it('should filter by status', async () => {
      const res = await request(app)
        .get(`/api/tickets?status=${TicketStatus.OPEN}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      res.body.data.tickets.forEach((t) => {
        expect(t.status).toBe(TicketStatus.OPEN);
      });
    });

    it('should filter by priority', async () => {
      const res = await request(app)
        .get(`/api/tickets?priority=${TicketPriority.MEDIUM}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      res.body.data.tickets.forEach((t) => {
        expect(t.priority).toBe(TicketPriority.MEDIUM);
      });
    });

    it('should return pagination metadata', async () => {
      const res = await request(app)
        .get('/api/tickets?page=1&limit=5')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('page');
      expect(res.body.data).toHaveProperty('limit');
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('totalPages');
    });
  });

  // ============================================================
  // 3. GET /api/tickets/:id — Ticket Detail
  // ============================================================
  describe('GET /api/tickets/:id — Ticket Detail', () => {
    let createdTicketId, createdTicketNumber;

    beforeEach(async () => {
      const res = await createTicketViaApi(customerToken);
      createdTicketId = res.body.data.ticket._id;
      createdTicketNumber = res.body.data.ticket.ticketNumber;
    });

    it('should return ticket detail for the owning customer', async () => {
      const res = await request(app)
        .get(`/api/tickets/${createdTicketId}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.ticket._id).toBe(createdTicketId);
    });

    it('should return ticket by ticketNumber too', async () => {
      const res = await request(app)
        .get(`/api/tickets/${createdTicketNumber}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.ticket.ticketNumber).toBe(createdTicketNumber);
    });

    it('should return 401 for unauthenticated request', async () => {
      const res = await request(app).get(`/api/tickets/${createdTicketId}`);
      expect(res.status).toBe(401);
    });

    it('should return 404 for non-existent ticket', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/tickets/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    it('should DENY customer access to another customer\'s ticket', async () => {
      // Create a second customer
      const other = await User.create({
        fullName: 'Sneaky Customer',
        email: 'sneaky@tickettest.com',
        phone: '+918888800077',
        passwordHash: 'dummy',
        role: UserRole.CUSTOMER,
        isActive: true,
      });
      const sneakyToken = signAccessToken({ userId: other._id.toString(), role: UserRole.CUSTOMER });

      const res = await request(app)
        .get(`/api/tickets/${createdTicketId}`)
        .set('Authorization', `Bearer ${sneakyToken}`);
      expect(res.status).toBe(403);
    });

    it('should allow admin to access any ticket', async () => {
      const res = await request(app)
        .get(`/api/tickets/${createdTicketId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    });

    it('should allow agent to access any ticket', async () => {
      const res = await request(app)
        .get(`/api/tickets/${createdTicketId}`)
        .set('Authorization', `Bearer ${agentToken}`);
      expect(res.status).toBe(200);
    });

    it('should not expose sensitive user fields like passwordHash', async () => {
      const res = await request(app)
        .get(`/api/tickets/${createdTicketId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const ticket = res.body.data.ticket;
      if (ticket.requesterId && typeof ticket.requesterId === 'object') {
        expect(ticket.requesterId.passwordHash).toBeUndefined();
        expect(ticket.requesterId.refreshTokens).toBeUndefined();
      }
    });
  });

  // ============================================================
  // 4. Ticket Messages — Internal Note Privacy
  // ============================================================
  describe('Ticket Messages & Internal Note Security', () => {
    let ticketId;

    beforeEach(async () => {
      const res = await createTicketViaApi(customerToken);
      ticketId = res.body.data.ticket._id;

      // Agent adds an internal note
      await request(app)
        .post(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: 'This is an internal note.', type: 'INTERNAL' });
    });

    it('should allow agent to create an internal note', async () => {
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: 'Another internal note.', type: 'INTERNAL' });
      expect(res.status).toBe(201);
      expect(res.body.data.message.type).toBe('INTERNAL');
    });

    it('should DENY customer from creating internal notes', async () => {
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ body: 'Trying to post internal note.', type: 'INTERNAL' });
      expect(res.status).toBe(403);
    });

    it('should NOT return internal notes to customer when reading messages', async () => {
      const res = await request(app)
        .get(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      const messages = res.body.data.messages;
      messages.forEach((msg) => {
        expect(msg.type).not.toBe('INTERNAL');
        expect(msg.type).not.toBe('INTERNAL_NOTE');
      });
    });

    it('should return internal notes to agent', async () => {
      const res = await request(app)
        .get(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${agentToken}`);
      expect(res.status).toBe(200);
      const hasInternal = res.body.data.messages.some(
        (m) => m.type === 'INTERNAL' || m.type === 'INTERNAL_NOTE'
      );
      expect(hasInternal).toBe(true);
    });

    it('should return internal notes to admin', async () => {
      const res = await request(app)
        .get(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const hasInternal = res.body.data.messages.some(
        (m) => m.type === 'INTERNAL' || m.type === 'INTERNAL_NOTE'
      );
      expect(hasInternal).toBe(true);
    });

    it('should DENY customer from reading another customer\'s messages', async () => {
      // Create another customer's ticket
      const other = await User.create({
        fullName: 'Another Customer',
        email: 'another@tickettest.com',
        phone: '+918888800044',
        passwordHash: 'dummy',
        role: UserRole.CUSTOMER,
        isActive: true,
      });
      const otherToken = signAccessToken({ userId: other._id.toString(), role: UserRole.CUSTOMER });

      const res = await request(app)
        .get(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${otherToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ============================================================
  // 5. Ticket Assignment — RBAC
  // ============================================================
  describe('POST /api/tickets/:id/assign — RBAC', () => {
    let ticketId;

    beforeEach(async () => {
      const res = await createTicketViaApi(customerToken);
      ticketId = res.body.data.ticket._id;
    });

    it('should DENY customer from assigning tickets', async () => {
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ agentId: agentUser._id.toString() });
      expect(res.status).toBe(403);
    });

    it('should allow admin to assign ticket to an agent', async () => {
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: agentUser._id.toString() });
      expect(res.status).toBe(200);
      expect(res.body.data.ticket.assignedTo).toBeDefined();
    });

    it('should allow agent to assign ticket', async () => {
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ agentId: agentUser._id.toString() });
      expect(res.status).toBe(200);
    });
  });

  // ============================================================
  // 6. Dashboard Summary — Role Scoping
  // ============================================================
  describe('GET /api/dashboard/summary — Role Scoping', () => {
    beforeEach(async () => {
      await createTicketViaApi(customerToken);
    });

    it('should return 401 for unauthenticated request', async () => {
      const res = await request(app).get('/api/dashboard/summary');
      expect(res.status).toBe(401);
    });

    it('should return customer\'s own statistics for CUSTOMER role', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('CUSTOMER');
      expect(res.body.data.counts).toBeDefined();
    });

    it('should return global stats for ADMIN role', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('ADMIN');
    });

    it('should return agent-scoped stats for AGENT role', async () => {
      const res = await request(app)
        .get('/api/dashboard/summary')
        .set('Authorization', `Bearer ${agentToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('AGENT');
      expect(res.body.data.counts.assignedOpen).toBeDefined();
    });
  });

  // ============================================================
  // 7. Category Management — RBAC & Operations
  // ============================================================
  describe('Category Management — RBAC', () => {
    it('should allow public or authenticated user to read categories', async () => {
      const res = await request(app).get('/api/categories');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.categories)).toBe(true);
    });

    it('should FORBID customer from creating a category', async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ name: 'Customer Category', description: 'Forbidden' });
      expect(res.status).toBe(403);
    });

    it('should FORBID agent from creating a category', async () => {
      const res = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ name: 'Agent Category', description: 'Forbidden' });
      expect(res.status).toBe(403);
    });

    it('should allow ADMIN to create, update, and toggle category', async () => {
      const createRes = await request(app)
        .post('/api/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Admin Test Category', description: 'Created by Admin' });
      expect(createRes.status).toBe(201);
      const catId = createRes.body.data.category._id;

      // Update
      const updateRes = await request(app)
        .put(`/api/categories/${catId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated Admin Category', description: 'New description' });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.category.name).toBe('Updated Admin Category');

      // Toggle active
      const toggleRes = await request(app)
        .patch(`/api/categories/${catId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });
      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.data.category.isActive).toBe(false);
    });
  });

  // ============================================================
  // 8. Ticket State Machine & Lifecycle (Resolve, Reopen, Close)
  // ============================================================
  describe('Ticket Lifecycle State Machine', () => {
    let ticketId;

    beforeEach(async () => {
      const res = await createTicketViaApi(customerToken);
      ticketId = res.body.data.ticket._id;
    });

    it('should reject invalid arbitrary state transitions with 400', async () => {
      // OPEN -> RESOLVED is invalid directly (must go through IN_PROGRESS or PENDING)
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'RESOLVED' });
      expect(res.status).toBe(400);
    });

    it('should allow agent/admin to transition OPEN -> IN_PROGRESS -> RESOLVED', async () => {
      // 1. OPEN -> IN_PROGRESS
      const inProgressRes = await request(app)
        .post(`/api/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ status: 'IN_PROGRESS' });
      expect(inProgressRes.status).toBe(200);
      expect(inProgressRes.body.data.ticket.status).toBe('IN_PROGRESS');

      // 2. IN_PROGRESS -> RESOLVED via dedicated resolve endpoint
      const resolveRes = await request(app)
        .post(`/api/tickets/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${agentToken}`);
      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.data.ticket.status).toBe('RESOLVED');
      expect(resolveRes.body.data.ticket.resolvedAt).toBeDefined();

      // 3. RESOLVED -> REOPENED
      const reopenRes = await request(app)
        .post(`/api/tickets/${ticketId}/reopen`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body.data.ticket.status).toBe('REOPENED');
      expect(reopenRes.body.data.ticket.reopenedAt).toBeDefined();

      // 4. Close ticket
      const closeRes = await request(app)
        .post(`/api/tickets/${ticketId}/close`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.data.ticket.status).toBe('CLOSED');
      expect(closeRes.body.data.ticket.closedAt).toBeDefined();
    });
  });

  // ============================================================
  // 9. Ticket Activity Timeline & Internal Note Privacy
  // ============================================================
  describe('Ticket Activity Timeline & Privacy Filter', () => {
    let ticketId;

    beforeEach(async () => {
      const res = await createTicketViaApi(customerToken);
      ticketId = res.body.data.ticket._id;

      // Add staff internal note
      await request(app)
        .post(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          body: 'This is a strictly confidential internal note for agents.',
          type: 'INTERNAL_NOTE',
        });

      // Add public reply
      await request(app)
        .post(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({
          body: 'We are actively investigating your issue.',
          type: 'PUBLIC',
        });
    });

    it('should NEVER leak internal note activity to customer', async () => {
      const res = await request(app)
        .get(`/api/tickets/${ticketId}/activity`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      const activities = res.body.data.activities;
      expect(Array.isArray(activities)).toBe(true);

      const hasInternalNote = activities.some(
        (a) => a.action === 'INTERNAL_NOTE' || a.action === 'INTERNAL_NOTE_ADDED'
      );
      expect(hasInternalNote).toBe(false);
    });

    it('should allow agent and admin to see all activity including internal notes', async () => {
      const res = await request(app)
        .get(`/api/tickets/${ticketId}/activity`)
        .set('Authorization', `Bearer ${agentToken}`);
      expect(res.status).toBe(200);
      const activities = res.body.data.activities;

      const hasInternalNote = activities.some(
        (a) => a.action === 'INTERNAL_NOTE' || a.action === 'INTERNAL_NOTE_ADDED'
      );
      expect(hasInternalNote).toBe(true);
    });
  });

  // ============================================================
  // 10. Email Notification Event Contracts
  //     (Validates that actions complete successfully 200/201
  //      regardless of SMTP delivery — email is fire-and-forget)
  // ============================================================
  describe('Email Notification Event Contracts', () => {
    let ticketId;

    beforeEach(async () => {
      const res = await createTicketViaApi(customerToken);
      expect(res.status).toBe(201);
      ticketId = res.body.data.ticket._id;
    });

    // ── Assignment ──────────────────────────────────────────────────────────

    it('should complete assignment and return 200 regardless of email delivery', async () => {
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: agentUser._id.toString() });
      // Action must always succeed — email is fire-and-forget
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ticket.assignedTo).toBeDefined();
    });

    it('should complete reassignment without error', async () => {
      // First assignment
      await request(app)
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: agentUser._id.toString() });

      // Reassign to admin
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: adminUser._id.toString() });
      expect(res.status).toBe(200);
      expect(res.body.data.ticket.assignedTo._id.toString()).toBe(adminUser._id.toString());
    });

    it('should complete unassign (agentId omitted) without error', async () => {
      await request(app)
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ agentId: agentUser._id.toString() });

      const res = await request(app)
        .post(`/api/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.ticket.assignedTo).toBeNull();
    });

    // ── Public Reply (Agent → Customer email) ───────────────────────────────

    it('should post agent public reply and return 201 regardless of email delivery', async () => {
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: 'We are looking into your issue right now.', type: 'PUBLIC' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message.type).toBe('PUBLIC');
    });

    it('should post customer public reply and return 201 regardless of email delivery', async () => {
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ body: 'Thank you for the update. Still experiencing the issue.' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should post INTERNAL_NOTE and return 201 — customers must NOT see it', async () => {
      const noteRes = await request(app)
        .post(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ body: 'Check backend logs for error trace.', type: 'INTERNAL_NOTE' });
      expect(noteRes.status).toBe(201);
      expect(noteRes.body.data.message.type).toBe('INTERNAL');

      // Customer cannot see it
      const msgRes = await request(app)
        .get(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(msgRes.status).toBe(200);
      const hasInternal = msgRes.body.data.messages.some((m) => m.type === 'INTERNAL');
      expect(hasInternal).toBe(false);
    });

    // ── Status lifecycle emails ─────────────────────────────────────────────

    it('should resolve ticket and return 200 regardless of email delivery', async () => {
      // Transition to IN_PROGRESS first
      await request(app)
        .post(`/api/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ status: 'IN_PROGRESS' });

      const res = await request(app)
        .post(`/api/tickets/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${agentToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.ticket.status).toBe('RESOLVED');
    });

    it('should reopen ticket and return 200 regardless of email delivery', async () => {
      await request(app)
        .post(`/api/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ status: 'IN_PROGRESS' });
      await request(app)
        .post(`/api/tickets/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${agentToken}`);

      const res = await request(app)
        .post(`/api/tickets/${ticketId}/reopen`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.ticket.status).toBe('REOPENED');
    });

    it('should close ticket and return 200 regardless of email delivery', async () => {
      await request(app)
        .post(`/api/tickets/${ticketId}/status`)
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ status: 'IN_PROGRESS' });
      await request(app)
        .post(`/api/tickets/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${agentToken}`);

      const res = await request(app)
        .post(`/api/tickets/${ticketId}/close`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.ticket.status).toBe('CLOSED');
    });

    // ── Security: customer reply must never trigger internal note ───────────

    it('should DENY customer from sending INTERNAL_NOTE via reply', async () => {
      const res = await request(app)
        .post(`/api/tickets/${ticketId}/messages`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ body: 'Attempt to bypass security.', type: 'INTERNAL_NOTE' });
      expect(res.status).toBe(403);
    });
  });
});

