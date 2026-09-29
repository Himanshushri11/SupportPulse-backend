const { Ticket } = require('../ticket/ticket.model');
const { TicketStatus } = require('../../constants/ticket');
const { sendSuccess } = require('../../utils/response');

class DashboardController {
  /**
   * Role-aware dashboard summary aggregation using MongoDB
   */
  async getSummary(req, res, next) {
    try {
      const { role, _id: userId } = req.user;
      let baseMatch = {};

      if (role === 'CUSTOMER') {
        baseMatch = { requesterId: userId };
      } else if (role === 'AGENT') {
        baseMatch = { assignedTo: { $in: [userId, null] } };
      }

      // Aggregation pipeline to calculate counts by status
      const [statusCounts, totalCount, unassignedCount, recentTickets] = await Promise.all([
        Ticket.aggregate([
          { $match: baseMatch },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Ticket.countDocuments(baseMatch),
        // For staff (Agent/Admin), count unassigned tickets
        role !== 'CUSTOMER'
          ? Ticket.countDocuments({ assignedTo: null, status: { $in: [TicketStatus.OPEN, TicketStatus.REOPENED] } })
          : 0,
        // Top 5 recent tickets
        Ticket.find(baseMatch)
          .sort({ updatedAt: -1 })
          .limit(5)
          .populate('category', 'name')
          .populate('assignedTo', 'fullName email')
          .populate('requesterId', 'fullName email'),
      ]);

      const counts = {
        total: totalCount,
        open: 0,
        inProgress: 0,
        pending: 0,
        resolved: 0,
        closed: 0,
        reopened: 0,
        unassigned: unassignedCount,
      };

      statusCounts.forEach((sc) => {
        if (sc._id === TicketStatus.OPEN) counts.open = sc.count;
        else if (sc._id === TicketStatus.IN_PROGRESS) counts.inProgress = sc.count;
        else if (sc._id === TicketStatus.PENDING) counts.pending = sc.count;
        else if (sc._id === TicketStatus.RESOLVED) counts.resolved = sc.count;
        else if (sc._id === TicketStatus.CLOSED) counts.closed = sc.count;
        else if (sc._id === TicketStatus.REOPENED) counts.reopened = sc.count;
      });

      // Role-specific metrics per requirements
      let roleMetrics = {};
      if (role === 'CUSTOMER') {
        roleMetrics = {
          myOpen: counts.open + counts.reopened,
          myPending: counts.pending,
          myResolved: counts.resolved,
          myClosed: counts.closed,
        };
      } else if (role === 'AGENT') {
        // Query agent-specific counts
        const [agentOpen, agentInProgress, agentPending, agentResolved] = await Promise.all([
          Ticket.countDocuments({
            $or: [{ assignedTo: userId }, { assignedTo: null }],
            status: { $in: [TicketStatus.OPEN, TicketStatus.REOPENED] },
          }),
          Ticket.countDocuments({ assignedTo: userId, status: TicketStatus.IN_PROGRESS }),
          Ticket.countDocuments({ assignedTo: userId, status: TicketStatus.PENDING }),
          Ticket.countDocuments({ assignedTo: userId, status: TicketStatus.RESOLVED }),
        ]);
        roleMetrics = {
          assignedOpen: agentOpen,
          inProgress: agentInProgress,
          pending: agentPending,
          resolved: agentResolved,
        };
      } else if (role === 'ADMIN') {
        roleMetrics = {
          total: totalCount,
          open: counts.open + counts.reopened,
          inProgress: counts.inProgress,
          pending: counts.pending,
          resolved: counts.resolved,
          closed: counts.closed,
        };
      }

      return sendSuccess(
        res,
        {
          role,
          counts: {
            ...counts,
            ...roleMetrics,
          },
          roleMetrics,
          recentTickets,
        },
        'Dashboard summary retrieved successfully'
      );
    } catch (error) {
      next(error);
    }
  }
}

const dashboardController = new DashboardController();

module.exports = {
  DashboardController,
  dashboardController,
};
