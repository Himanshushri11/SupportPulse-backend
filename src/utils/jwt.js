const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { config } = require('../config');
const { UnauthorizedError } = require('./errors');

/**
 * Hashes a refresh token for secure database storage
 */
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Signs a short-lived access token with minimal necessary claims (userId, role)
 */
const signAccessToken = (payload) => {
  return jwt.sign(
    {
      userId: payload.userId,
      role: payload.role,
    },
    config.jwt.accessSecret,
    {
      expiresIn: config.jwt.accessExpiresIn,
    }
  );
};

/**
 * Signs a longer-lived refresh token with a unique jti identifier
 */
const signRefreshToken = (payload) => {
  return jwt.sign(
    {
      userId: payload.userId,
      jti: payload.jti,
    },
    config.jwt.refreshSecret,
    {
      expiresIn: config.jwt.refreshExpiresIn,
    }
  );
};

/**
 * Generates both access & refresh tokens, recording the refresh session in user document
 */
const generateAuthTokens = async (user) => {
  const jti = crypto.randomUUID();
  const userId = user._id.toString();

  const accessToken = signAccessToken({ userId, role: user.role });
  const refreshToken = signRefreshToken({ userId, jti });

  // Calculate refresh token expiry (7 days)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const newRefreshToken = {
    tokenHash: hashToken(refreshToken),
    jti,
    expiresAt,
    createdAt: new Date(),
  };

  await user.constructor.findByIdAndUpdate(user._id, {
    $push: {
      refreshTokens: {
        $each: [newRefreshToken],
        $slice: -10,
      },
    },
    $set: { lastLoginAt: new Date() },
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: config.jwt.accessExpiresIn,
  };
};

/**
 * Verifies access token
 */
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.accessSecret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Access token has expired');
    }
    throw new UnauthorizedError('Invalid access token');
  }
};

/**
 * Verifies refresh token
 */
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, config.jwt.refreshSecret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Refresh token has expired. Please log in again.');
    }
    throw new UnauthorizedError('Invalid refresh token');
  }
};

module.exports = {
  hashToken,
  signAccessToken,
  signRefreshToken,
  generateAuthTokens,
  verifyAccessToken,
  verifyRefreshToken,
};
