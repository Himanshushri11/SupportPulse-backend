const { Router } = require('express');
const mongoose = require('mongoose');
const { sendSuccess } = require('../../utils/response');

const router = Router();

router.get('/', (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'UP' : 'DOWN';
  return sendSuccess(
    res,
    {
      status: 'UP',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      uptime: process.uptime(),
    },
    'Email Support System API is healthy'
  );
});

module.exports = router;
