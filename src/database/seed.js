const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { User } = require('../modules/user/user.model');
const { UserRole } = require('../constants/roles');
const { config } = require('../config');

// Default passwords if env is not set (For development only, safe default)
const defaultPassword = process.env.SEED_PASSWORD || 'Secret123!';

async function seedDatabase() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(config.mongo.uri);
    console.log('Database connected.');

    const passwordHash = await bcrypt.hash(defaultPassword, 12);

    const users = [
      {
        fullName: 'Admin User',
        email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
        phone: '+10000000001',
        passwordHash,
        role: UserRole.ADMIN,
        isEmailVerified: true,
        isPhoneVerified: true,
        isActive: true,
      },
      {
        fullName: 'Agent User',
        email: process.env.SEED_AGENT_EMAIL || 'agent@example.com',
        phone: '+10000000002',
        passwordHash,
        role: UserRole.AGENT,
        isEmailVerified: true,
        isPhoneVerified: true,
        isActive: true,
      },
      {
        fullName: 'Customer User',
        email: process.env.SEED_CUSTOMER_EMAIL || 'customer@example.com',
        phone: '+10000000003',
        passwordHash,
        role: UserRole.CUSTOMER,
        isEmailVerified: true,
        isPhoneVerified: true,
        isActive: true,
      },
    ];

    for (const u of users) {
      const existingUser = await User.findOne({ email: u.email });
      if (!existingUser) {
        await User.create(u);
        console.log(`Created user: ${u.role} (${u.email})`);
      } else {
        console.log(`User already exists: ${u.role} (${u.email})`);
      }
    }

    console.log('Seeding complete. Use password:', defaultPassword);
    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
}

seedDatabase();
