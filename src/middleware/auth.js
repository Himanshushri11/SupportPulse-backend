const { verifyAccessToken } = require('../utils/jwt');
const { User } = require('../modules/user/user.model');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

/**
 * Authentication middleware: verifies Bearer access token and attaches user to req.user
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Authentication token missing or invalid');
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const user = await User.findById(decoded.userId).select(
      '_id fullName email phone role isActive isEmailVerified isPhoneVerified'
    );

    if (!user) {
      throw new UnauthorizedError('User account associated with this token no longer exists');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Account has been deactivated. Please contact support.');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role-Based Access Control (RBAC) middleware: checks if authenticated user possesses allowed role
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Access forbidden: Role '${req.user.role}' is not authorized to access this resource`
        )
      );
    }

    next();
  };
};

module.exports = {
  authenticate,
  authorizeRoles,
};
