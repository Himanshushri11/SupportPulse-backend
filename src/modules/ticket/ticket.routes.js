const { Router } = require('express');
const { ticketController } = require('./ticket.controller');
const { ticketMessageController } = require('../ticketMessage/ticketMessage.controller');
const { ticketActivityService } = require('../ticketActivity/ticketActivity.service');
const { Ticket } = require('./ticket.model');
const { authenticate, authorizeRoles } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const {
  createTicketSchema,
  updateTicketSchema,
  assignTicketSchema,
  updateStatusSchema,
} = require('./ticket.validation');
const { createMessageSchema } = require('../ticketMessage/ticketMessage.validation');
const { sendSuccess } = require('../../utils/response');
const { NotFoundError, ForbiddenError } = require('../../utils/errors');

const router = Router();

// 1. Ticket CRUD Operations
router.post(
  '/',
  authenticate,
  validate(createTicketSchema),
  ticketController.createTicket.bind(ticketController)
);

router.get(
  '/',
  authenticate,
  ticketController.getTickets.bind(ticketController)
);

router.get(
  '/agents',
  authenticate,
  authorizeRoles('AGENT', 'ADMIN'),
  ticketController.getAgents.bind(ticketController)
);

router.get(
  '/:ticketId',
  authenticate,
  ticketController.getTicketById.bind(ticketController)
);

router.patch(
  '/:ticketId',
  authenticate,
  validate(updateTicketSchema),
  ticketController.updateTicket.bind(ticketController)
);

// 2. Assignment & Reassignment
router.post(
  '/:ticketId/assign',
  authenticate,
  authorizeRoles('AGENT', 'ADMIN'),
  validate(assignTicketSchema),
  ticketController.assignTicket.bind(ticketController)
);

// 3. Status Transitions & Lifecycle Actions
router.post(
  '/:ticketId/status',
  authenticate,
  validate(updateStatusSchema),
  ticketController.updateStatus.bind(ticketController)
);

router.post(
  '/:ticketId/resolve',
  authenticate,
  ticketController.resolveTicket.bind(ticketController)
);

router.post(
  '/:ticketId/reopen',
  authenticate,
  ticketController.reopenTicket.bind(ticketController)
);

router.post(
  '/:ticketId/close',
  authenticate,
  ticketController.closeTicket.bind(ticketController)
);

// 4. Conversation Messages (Public Replies & Internal Notes)
router.get(
  '/:ticketId/messages',
  authenticate,
  ticketMessageController.getMessages.bind(ticketMessageController)
);

router.post(
  '/:ticketId/messages',
  authenticate,
  validate(createMessageSchema),
  ticketMessageController.createMessage.bind(ticketMessageController)
);

// 5. Audit Activity Timeline
router.get('/:ticketId/activity', authenticate, async (req, res, next) => {
  try {
    const { ticketId } = req.params;

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }

    if (req.user.role === 'CUSTOMER' && !ticket.requesterId.equals(req.user._id)) {
      throw new ForbiddenError('You do not have permission to view activity for this ticket');
    }

    const activities = await ticketActivityService.getActivitiesForTicket(
      ticket._id,
      req.user.role
    );

    return sendSuccess(res, { activities }, 'Ticket activity timeline retrieved successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
