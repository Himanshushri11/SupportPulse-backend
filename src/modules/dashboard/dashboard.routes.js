const { Router } = require('express');
const { dashboardController } = require('./dashboard.controller');
const { authenticate } = require('../../middleware/auth');

const router = Router();

router.get(
  '/summary',
  authenticate,
  dashboardController.getSummary.bind(dashboardController)
);

module.exports = router;
