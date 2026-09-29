/**
 * test_email_flow.js
 * -----------------
 * End-to-end test:
 *   1. Fetch a real active category from DB
 *   2. Register & log in as a Customer
 *   3. Create a ticket
 *   4. Verify the ticket was saved
 *   5. Confirm email was dispatched (check logs above after this script)
 */
const mongoose = require('mongoose');
const request = require('supertest');
const { createApp } = require('./src/app');
const { User } = require('./src/modules/user/user.model');
const { Category } = require('./src/modules/category/category.model');

const app = createApp();

async function run() {
  await mongoose.connect('mongodb://127.0.0.1/ticketing_system');
  console.log('✓ Connected to DB');

  try {
    // ── 1. Find a real active category ──────────────────────────────────
    const category = await Category.findOne({ isActive: true });
    if (!category) {
      console.error('✗ No active category found. Please seed categories first.');
      return;
    }
    console.log(`✓ Using category: "${category.name}" (${category._id})`);

    // ── 2. Make sure test customer exists ───────────────────────────────
    // Clean up stale test user if any
    await User.deleteOne({ email: 'emailtest@test.com' });

    const regRes = await request(app).post('/api/auth/register').send({
      fullName: 'Email Test Customer',
      email: 'emailtest@test.com',
      phone: '+9199999999',
      password: 'Password123!',
      role: 'CUSTOMER',
    });

    if (regRes.status !== 201) {
      console.error('✗ Registration failed:', regRes.body);
      return;
    }
    console.log('✓ Customer registered');

    // Manually mark email verified so we can log in
    await User.findOneAndUpdate(
      { email: 'emailtest@test.com' },
      { isEmailVerified: true }
    );
    console.log('✓ Email marked as verified');

    // ── 3. Log in ────────────────────────────────────────────────────────
    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'emailtest@test.com',
      password: 'Password123!',
    });

    if (!loginRes.body.data?.tokens?.accessToken) {
      console.error('✗ Login failed:', loginRes.body);
      return;
    }
    const { accessToken } = loginRes.body.data.tokens;
    console.log('✓ Logged in — role:', loginRes.body.data.user.role);

    // ── 4. Create a ticket ───────────────────────────────────────────────
    const ticketRes = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Email Flow Test Ticket',
        description: 'This is an automated test to verify that ticket creation emails are sent to both the customer and the admin.',
        categoryId: category._id.toString(),
        priority: 'HIGH',
      });

    if (ticketRes.status !== 201) {
      console.error('✗ Ticket creation failed:', JSON.stringify(ticketRes.body, null, 2));
      return;
    }

    const ticket = ticketRes.body.data.ticket;
    console.log('✓ Ticket created:', ticket.ticketNumber);
    console.log('  Subject  :', ticket.title);
    console.log('  Category :', ticket.category?.name);
    console.log('  Priority :', ticket.priority);
    console.log('  Status   :', ticket.status);
    console.log('\n✓ SUCCESS — check the backend logs above for email delivery results.');
    console.log('  Customer email → emailtest@test.com');
    console.log('  Admin email    → ' + (process.env.ADMIN_SUPPORT_EMAIL || '(ADMIN_SUPPORT_EMAIL not set)'));

  } catch (err) {
    console.error('Unexpected error:', err.message);
    console.error(err.stack);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
