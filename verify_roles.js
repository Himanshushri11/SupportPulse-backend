const mongoose = require('mongoose');
const { User } = require('./src/modules/user/user.model');
const request = require('supertest');
const { createApp } = require('./src/app');
const app = createApp();

async function run() {
  await mongoose.connect('mongodb://127.0.0.1/ticketing_system');
  console.log('Connected to DB');

  try {
    // Clean up test users first
    await User.deleteMany({ email: { $in: ['newcust@test.com', 'newagent@test.com', 'newadmin@test.com'] } });

    // Test Registration endpoints
    const regCust = await request(app).post('/api/auth/register').send({
      fullName: 'New Customer', email: 'newcust@test.com', phone: '+1111111111', password: 'Password123!', role: 'CUSTOMER'
    });
    console.log('Registered Customer Role:', regCust.body.data.user.role);

    const regAgent = await request(app).post('/api/auth/register').send({
      fullName: 'New Agent', email: 'newagent@test.com', phone: '+2222222222', password: 'Password123!', role: 'AGENT'
    });
    console.log('Registered Agent Role:', regAgent.body.data.user.role);

    const regAdmin = await request(app).post('/api/auth/register').send({
      fullName: 'New Admin', email: 'newadmin@test.com', phone: '+3333333333', password: 'Password123!', role: 'ADMIN'
    });
    console.log('Registered Admin Role:', regAdmin.body.data.user.role);

    if (
      regCust.body.data.user.role === 'CUSTOMER' &&
      regAgent.body.data.user.role === 'AGENT' &&
      regAdmin.body.data.user.role === 'ADMIN'
    ) {
      console.log('SUCCESS: All 3 roles successfully registered and validated via API.');
    } else {
      console.error('FAILURE: Role mismatch.');
    }

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
