const UserRole = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  AGENT: 'AGENT',
  ADMIN: 'ADMIN',
});

const ROLES = Object.values(UserRole);

module.exports = {
  UserRole,
  ROLES,
};
