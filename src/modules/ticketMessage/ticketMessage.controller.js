const { TicketMessage } = require('./ticketMessage.model');
const { Ticket } = require('../ticket/ticket.model');
const { User } = require('../user/user.model');
const { ticketActivityService } = require('../ticketActivity/ticketActivity.service');
const { ticketStateMachine } = require('../ticket/ticket.stateMachine');
const { notificationService } = require('../../services/notification.service');
const { logger } = require('../../utils/logger');
const {
  TicketStatus,
  MessageType,
  MessageSource,
  ActivityAction,
} = require('../../constants/ticket');
const { sendSuccess, sendCreated } = require('../../utils/response');
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require('../../utils/errors');

class TicketMessageController {
  /**
   * Get chronological conversation messages with privacy filtering
   */
  async getMessages(req, res, next) {
    try {
      const { ticketId } = req.params;
      const { page = 1, limit = 50 } = req.query;

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        throw new NotFoundError('Ticket not found');
      }

      // Authorization check
      if (req.user.role === 'CUSTOMER') {
        if (!ticket.requesterId.equals(req.user._id)) {
          throw new ForbiddenError('You do not have permission to view conversation for this ticket');
        }
      }

      // CRITICAL PRIVACY BOUNDARY:
      // Customers ONLY receive PUBLIC messages.
      // Staff (Agent/Admin) receive both PUBLIC and INTERNAL notes.
      const query = { ticketId };
      if (req.user.role === 'CUSTOMER') {
        query.type = { $in: ['PUBLIC', 'PUBLIC_REPLY', 'REPLY'] };
      }

      const [messages, total] = await Promise.all([
        TicketMessage.find(query)
          .sort({ createdAt: 1 })
          .skip(skip)
          .limit(limitNum)
          .populate('senderId', 'fullName email role'),
        TicketMessage.countDocuments(query),
      ]);

      return sendSuccess(
        res,
        {
          messages,
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
        'Conversation messages retrieved successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a message: Public Reply or Staff Internal Note
   */
  async createMessage(req, res, next) {
    try {
      const { ticketId } = req.params;
      const { body, type = 'PUBLIC', attachments = [] } = req.body;

      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        throw new NotFoundError('Ticket not found');
      }

      const isOwner = ticket.requesterId.equals(req.user._id);

      // Authorization check
      if (req.user.role === 'CUSTOMER') {
        if (!isOwner) {
          throw new ForbiddenError('You can only reply to your own tickets');
        }
      }

      // PRIVACY BOUNDARY: Customer cannot create INTERNAL notes
      const isInternal = type === 'INTERNAL' || type === 'INTERNAL_NOTE';
      if (isInternal && req.user.role === 'CUSTOMER') {
        throw new ForbiddenError('Customers are strictly unauthorized to create internal notes');
      }

      const normalizedType = isInternal ? MessageType.INTERNAL : MessageType.PUBLIC;

      // Create message document
      const message = await TicketMessage.create({
        ticketId: ticket._id,
        senderId: req.user._id,
        senderEmail: req.user.email,
        senderRole: req.user.role,
        type: normalizedType,
        body: body.trim(),
        attachments,
        source: MessageSource.WEB,
      });

      // Update ticket lastMessageAt
      ticket.lastMessageAt = new Date();

      // Lifecycle automation:
      // If Customer replies to a PENDING ticket, auto-shift back to IN_PROGRESS
      if (req.user.role === 'CUSTOMER' && ticket.status === TicketStatus.PENDING) {
        ticket.status = TicketStatus.IN_PROGRESS;
        await ticketActivityService.logActivity({
          ticketId: ticket._id,
          actor: req.user,
          action: ActivityAction.STATUS_CHANGED,
          oldValue: TicketStatus.PENDING,
          newValue: TicketStatus.IN_PROGRESS,
          metadata: { reason: 'Customer replied to pending inquiry' },
        });
      }

      // If Customer replies to RESOLVED ticket, auto-reopen
      if (req.user.role === 'CUSTOMER' && ticket.status === TicketStatus.RESOLVED) {
        ticket.status = TicketStatus.REOPENED;
        ticket.reopenedAt = new Date();
        ticket.resolvedAt = null;
        await ticketActivityService.logActivity({
          ticketId: ticket._id,
          actor: req.user,
          action: ActivityAction.REOPENED,
          oldValue: TicketStatus.RESOLVED,
          newValue: TicketStatus.REOPENED,
          metadata: { reason: 'Customer reopened via reply' },
        });
      }

      await ticket.save();

      // Log conversation activity
      await ticketActivityService.logActivity({
        ticketId: ticket._id,
        actor: req.user,
        action: isInternal ? ActivityAction.INTERNAL_NOTE_ADDED : ActivityAction.PUBLIC_REPLY_ADDED,
        metadata: {
          preview: body.trim().substring(0, 100),
          isInternal,
        },
      });

      await message.populate('senderId', 'fullName email role');

      // ── Email Notifications (fire-and-forget, never block response) ──────
      if (!isInternal) {
        // Hydrate customer and assigned agent from DB
        const [customerDoc, assignedAgentDoc] = await Promise.all([
          ticket.requesterId ? User.findById(ticket.requesterId).select('fullName email').lean() : Promise.resolve(null),
          ticket.assignedTo ? User.findById(ticket.assignedTo).select('fullName email').lean() : Promise.resolve(null),
        ]);

        if (req.user.role === 'CUSTOMER') {
          // Customer replied → notify agent + admin support mailbox
          notificationService
            .sendCustomerReplyNotifications({
              ticket,
              customer: customerDoc || { email: req.user.email, fullName: req.user.fullName },
              replyBody: body.trim(),
              assignedAgent: assignedAgentDoc,
            })
            .catch((e) => logger.error(`Customer reply notification failed (${ticket.ticketNumber}): ${e.message}`));
        } else {
          // Agent/Admin public reply → notify customer + admin support mailbox (2 separate deliveries)
          notificationService
            .sendAgentReplyNotifications({
              ticket,
              customer: customerDoc,
              replyBody: body.trim(),
              senderName: req.user.fullName || req.user.email,
            })
            .catch((e) => logger.error(`Agent reply notification failed (${ticket.ticketNumber}): ${e.message}`));
        }
      }
      // Internal notes: NO emails sent to anyone outside staff — activity log already handles it.

      return sendCreated(
        res,
        { message },
        isInternal ? 'Internal note added' : 'Public reply posted successfully'
      );
    } catch (error) {
      next(error);
    }
  }
}

const ticketMessageController = new TicketMessageController();

module.exports = {
  TicketMessageController,
  ticketMessageController,
};
