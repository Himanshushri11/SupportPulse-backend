const mongoose = require('mongoose');
const { Ticket } = require('./ticket.model');
const { getNextTicketNumber } = require('./counter.model');
const { Category } = require('../category/category.model');
const { User } = require('../user/user.model');
const { TicketMessage } = require('../ticketMessage/ticketMessage.model');
const { ticketActivityService } = require('../ticketActivity/ticketActivity.service');
const { ticketStateMachine } = require('./ticket.stateMachine');
const { notificationService } = require('../../services/notification.service');
const { logger } = require('../../utils/logger');
const { getIO } = require('../../socket');
const {
  TicketStatus,
  TicketPriority,
  MessageType,
  MessageSource,
  ActivityAction,
} = require('../../constants/ticket');
const {
  sendSuccess,
  sendCreated,
} = require('../../utils/response');
const {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} = require('../../utils/errors');

class TicketController {
  /**
   * Create a new ticket (Authenticated user, typically CUSTOMER)
   */
  async createTicket(req, res, next) {
    try {
      const { title, subject, description, categoryId, category: catField, priority } = req.body;
      const finalTitle = (title || subject || '').trim();
      const finalCategoryId = categoryId || catField;

      // Validate category existence and active state
      const categoryDoc = await Category.findOne({
        _id: finalCategoryId,
        isActive: true,
      });

      if (!categoryDoc) {
        throw new NotFoundError('Selected category does not exist or is inactive');
      }

      // Concurrency-safe sequential ticket number generation
      const ticketNumber = await getNextTicketNumber();

      // Create Ticket
      const ticket = await Ticket.create({
        ticketNumber,
        title: finalTitle,
        description: description.trim(),
        requesterId: req.user._id,
        requesterEmail: req.user.email,
        category: categoryDoc._id,
        priority: priority || TicketPriority.MEDIUM,
        status: TicketStatus.OPEN,
        lastMessageAt: new Date(),
      });

      // Create initial conversation message from requester
      await TicketMessage.create({
        ticketId: ticket._id,
        senderId: req.user._id,
        senderEmail: req.user.email,
        senderRole: req.user.role,
        body: description.trim(),
        type: MessageType.PUBLIC,
        source: MessageSource.WEB,
      });

      // Create immutable audit log entry
      await ticketActivityService.logActivity({
        ticketId: ticket._id,
        actor: req.user,
        action: ActivityAction.TICKET_CREATED,
        newValue: ticket.ticketNumber,
        metadata: {
          title: finalTitle,
          priority: ticket.priority,
          category: categoryDoc.name,
        },
      });

      // Populate category and requester before responding
      await ticket.populate([
        { path: 'category', select: 'name description' },
        { path: 'requesterId', select: 'fullName email phone' },
      ]);

      // Send email notifications — fire-and-forget; NEVER blocks ticket creation
      notificationService
        .sendTicketCreatedNotifications({
          ticket,
          customer: ticket.requesterId,
        })
        .catch((emailErr) => {
          logger.error(
            `Ticket email notifications failed for ${ticket.ticketNumber}: ${emailErr.message}`
          );
        });

      // Real-time notification to admin dashboard — fire-and-forget
      try {
        getIO().to('admin-room').emit('new-ticket', {
          ticketId: ticket._id,
          ticketNumber: ticket.ticketNumber,
          title: ticket.title,
          priority: ticket.priority,
          status: ticket.status,
          category: ticket.category?.name,
          customerName: ticket.requesterId?.fullName,
          customerEmail: ticket.requesterId?.email,
          createdAt: ticket.createdAt,
        });
        logger.info(`[Socket] Emitted new-ticket event for ${ticket.ticketNumber}`);
      } catch (socketErr) {
        logger.error(`[Socket] Failed to emit new-ticket for ${ticket.ticketNumber}: ${socketErr.message}`);
      }

      return sendCreated(res, { ticket }, 'Ticket created successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * List tickets with role-based scoping, pagination, filtering, and search
   */
  async getTickets(req, res, next) {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        priority,
        categoryId,
        assignedTo,
        search,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = req.query;

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const query = {};

      // 1. Role-Based Scoping
      if (req.user.role === 'CUSTOMER') {
        // Customer strictly sees only their own tickets
        query.requesterId = req.user._id;
      } else if (req.user.role === 'AGENT') {
        // Agent filtering options
        if (assignedTo === 'me') {
          query.assignedTo = req.user._id;
        } else if (assignedTo === 'unassigned') {
          query.assignedTo = null;
        } else if (assignedTo && mongoose.isValidObjectId(assignedTo)) {
          query.assignedTo = assignedTo;
        }
        // If no assignedTo filter provided, Agent can view team tickets
      } else if (req.user.role === 'ADMIN') {
        // Admin can filter by any assigned agent, 'me', 'unassigned', or view all
        if (assignedTo === 'me') {
          query.assignedTo = req.user._id;
        } else if (assignedTo === 'unassigned') {
          query.assignedTo = null;
        } else if (assignedTo && mongoose.isValidObjectId(assignedTo)) {
          query.assignedTo = assignedTo;
        }
      }

      // 2. Status & Priority & Category Filters
      if (status && Object.values(TicketStatus).includes(status)) {
        query.status = status;
      }

      if (priority && Object.values(TicketPriority).includes(priority)) {
        query.priority = priority;
      }

      if (categoryId && mongoose.isValidObjectId(categoryId)) {
        query.category = categoryId;
      }

      // 3. Search Filter (by ticket number or text search on title & description)
      if (search && search.trim()) {
        const searchTerm = search.trim();
        const searchRegex = new RegExp(searchTerm, 'i');
        query.$or = [
          { ticketNumber: searchRegex },
          { title: searchRegex },
          { requesterEmail: searchRegex },
        ];
      }

      // Sorting
      const sort = {};
      const validSortFields = ['createdAt', 'updatedAt', 'lastMessageAt', 'priority', 'status', 'ticketNumber'];
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
      sort[sortField] = sortOrder === 'asc' ? 1 : -1;

      const [tickets, total] = await Promise.all([
        Ticket.find(query)
          .sort(sort)
          .skip(skip)
          .limit(limitNum)
          .populate('requesterId', 'fullName email phone')
          .populate('assignedTo', 'fullName email')
          .populate('category', 'name description'),
        Ticket.countDocuments(query),
      ]);

      const totalPages = Math.ceil(total / limitNum);

      return sendSuccess(
        res,
        {
          tickets,
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
        },
        'Tickets retrieved successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single ticket by MongoDB _id or ticketNumber with strict authorization
   */
  async getTicketById(req, res, next) {
    try {
      const { ticketId } = req.params;

      const query = mongoose.isValidObjectId(ticketId)
        ? { _id: ticketId }
        : { ticketNumber: ticketId.toUpperCase().trim() };

      const ticket = await Ticket.findOne(query)
        .populate('requesterId', 'fullName email phone')
        .populate('assignedTo', 'fullName email phone')
        .populate('category', 'name description');

      if (!ticket) {
        throw new NotFoundError('Ticket not found');
      }

      // Customer authorization boundary
      if (req.user.role === 'CUSTOMER') {
        const isOwner =
          ticket.requesterId._id?.equals(req.user._id) ||
          ticket.requesterId.equals?.(req.user._id);
        if (!isOwner) {
          throw new ForbiddenError('You do not have permission to view this ticket');
        }
      }

      return sendSuccess(res, { ticket }, 'Ticket details retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update controlled fields of a ticket (priority, category, title)
   */
  async updateTicket(req, res, next) {
    try {
      const { ticketId } = req.params;
      const { title, priority, categoryId } = req.body;

      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        throw new NotFoundError('Ticket not found');
      }

      const isOwner = ticket.requesterId.equals(req.user._id);

      // Customer restrictions
      if (req.user.role === 'CUSTOMER') {
        if (!isOwner) {
          throw new ForbiddenError('You do not have permission to update this ticket');
        }
        if (priority || categoryId) {
          throw new ForbiddenError('Customers cannot alter ticket priority or classification');
        }
      }

      // Priority change
      if (priority && priority !== ticket.priority) {
        const oldPriority = ticket.priority;
        ticket.priority = priority;
        await ticketActivityService.logActivity({
          ticketId: ticket._id,
          actor: req.user,
          action: ActivityAction.PRIORITY_CHANGED,
          oldValue: oldPriority,
          newValue: priority,
        });
      }

      // Category change
      if (categoryId && !ticket.category.equals(categoryId)) {
        const newCat = await Category.findById(categoryId);
        if (!newCat) {
          throw new NotFoundError('Target category not found');
        }
        const oldCatId = ticket.category;
        ticket.category = newCat._id;
        await ticketActivityService.logActivity({
          ticketId: ticket._id,
          actor: req.user,
          action: ActivityAction.CATEGORY_CHANGED,
          oldValue: oldCatId.toString(),
          newValue: newCat.name,
        });
      }

      if (title && title.trim()) {
        ticket.title = title.trim();
      }

      await ticket.save();
      await ticket.populate([
        { path: 'requesterId', select: 'fullName email phone' },
        { path: 'assignedTo', select: 'fullName email' },
        { path: 'category', select: 'name description' },
      ]);

      return sendSuccess(res, { ticket }, 'Ticket updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * List active agents and admins for assignment dropdown
   */
  async getAgents(req, res, next) {
    try {
      const agents = await User.find({
        role: { $in: ['AGENT', 'ADMIN'] },
        isActive: true,
      })
        .select('fullName email role')
        .sort({ fullName: 1 });

      return sendSuccess(res, { agents }, 'Agents retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Assign or reassign ticket to an Agent (Admin or authorized Agent)
   */
  async assignTicket(req, res, next) {
    try {
      const { ticketId } = req.params;
      const { agentId } = req.body;

      if (req.user.role === 'CUSTOMER') {
        throw new ForbiddenError('Customers are not authorized to assign tickets');
      }

      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        throw new NotFoundError('Ticket not found');
      }

      let targetAgent = null;
      if (agentId) {
        targetAgent = await User.findOne({
          _id: agentId,
          role: { $in: ['AGENT', 'ADMIN'] },
          isActive: true,
        });

        if (!targetAgent) {
          throw new BadRequestError('Specified assignee is not an active Support Agent or Admin');
        }
      }

      const previousAssignee = ticket.assignedTo;
      let previousAssigneeName = 'UNASSIGNED';
      if (previousAssignee) {
        const prevUser = await User.findById(previousAssignee).select('fullName email');
        previousAssigneeName = prevUser ? `${prevUser.fullName} (${prevUser.email})` : previousAssignee.toString();
      }

      const isReassignment = !!previousAssignee && previousAssignee.toString() !== agentId;

      ticket.assignedTo = targetAgent ? targetAgent._id : null;
      ticket.assignedAt = targetAgent ? new Date() : null;

      // Auto-transition OPEN ticket to IN_PROGRESS upon initial assignment
      if (ticket.status === TicketStatus.OPEN && targetAgent) {
        ticket.status = TicketStatus.IN_PROGRESS;
      }

      await ticket.save();

      // Log assignment activity
      await ticketActivityService.logActivity({
        ticketId: ticket._id,
        actor: req.user,
        action: isReassignment ? ActivityAction.TICKET_REASSIGNED : ActivityAction.TICKET_ASSIGNED,
        oldValue: previousAssigneeName,
        newValue: targetAgent ? `${targetAgent.fullName} (${targetAgent.email})` : 'UNASSIGNED',
      });

      await ticket.populate([
        { path: 'requesterId', select: 'fullName email phone' },
        { path: 'assignedTo', select: 'fullName email' },
        { path: 'category', select: 'name description' },
      ]);

      // Fire-and-forget: assignment emails to customer + assigned agent
      notificationService
        .sendAssignmentNotifications({
          ticket,
          customer: ticket.requesterId,
          assignee: targetAgent,
          isReassignment,
        })
        .catch((emailErr) =>
          logger.error(`Assignment email failed for ${ticket.ticketNumber}: ${emailErr.message}`)
        );

      return sendSuccess(
        res,
        { ticket },
        targetAgent
          ? `Ticket successfully assigned to ${targetAgent.fullName}`
          : 'Ticket unassigned'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update ticket status via Centralized State Machine
   */
  async updateStatus(req, res, next) {
    try {
      const { ticketId } = req.params;
      const { status } = req.body;

      const ticket = await Ticket.findById(ticketId);
      if (!ticket) {
        throw new NotFoundError('Ticket not found');
      }

      const isOwner = ticket.requesterId.equals(req.user._id);

      // Apply transition with strict validation
      const result = ticketStateMachine.applyTransition(ticket, status, req.user, isOwner);
      await ticket.save();

      // Audit activity
      await ticketActivityService.logActivity({
        ticketId: ticket._id,
        actor: req.user,
        action: result.action,
        oldValue: result.previousStatus,
        newValue: result.newStatus,
      });

      await ticket.populate([
        { path: 'requesterId', select: 'fullName email phone' },
        { path: 'assignedTo', select: 'fullName email' },
        { path: 'category', select: 'name description' },
      ]);

      // Fire-and-forget: status-change emails for RESOLVED / REOPENED / CLOSED
      const statusesWithNotification = [
        TicketStatus.RESOLVED,
        TicketStatus.REOPENED,
        TicketStatus.CLOSED,
      ];
      if (statusesWithNotification.includes(status)) {
        notificationService
          .sendStatusChangeNotifications({
            ticket,
            customer: ticket.requesterId,
            newStatus: status,
            actor: req.user,
          })
          .catch((emailErr) =>
            logger.error(`Status email failed for ${ticket.ticketNumber}: ${emailErr.message}`)
          );
      }

      return sendSuccess(res, { ticket }, `Ticket status updated to ${status}`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Dedicated Resolve action
   */
  async resolveTicket(req, res, next) {
    req.body.status = TicketStatus.RESOLVED;
    return this.updateStatus(req, res, next);
  }

  /**
   * Dedicated Reopen action
   */
  async reopenTicket(req, res, next) {
    req.body.status = TicketStatus.REOPENED;
    return this.updateStatus(req, res, next);
  }

  /**
   * Dedicated Close action
   */
  async closeTicket(req, res, next) {
    req.body.status = TicketStatus.CLOSED;
    return this.updateStatus(req, res, next);
  }
}

const ticketController = new TicketController();

module.exports = {
  TicketController,
  ticketController,
};