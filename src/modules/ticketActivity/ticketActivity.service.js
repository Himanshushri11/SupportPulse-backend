const { TicketActivity } = require('./ticketActivity.model');
const { logger } = require('../../utils/logger');

class TicketActivityService {
  /**
   * Logs an immutable ticket activity event
   */
  async logActivity({
    ticketId,
    actor = null,
    action,
    oldValue = null,
    newValue = null,
    metadata = {},
  }) {
    try {
      const activity = await TicketActivity.create({
        ticketId,
        actorId: actor?._id || actor?.id || null,
        actorEmail: actor?.email || 'system@supportpulse.internal',
        actorRole: actor?.role || 'SYSTEM',
        action,
        oldValue: oldValue !== null ? String(oldValue) : null,
        newValue: newValue !== null ? String(newValue) : null,
        metadata,
      });

      return activity;
    } catch (error) {
      logger.error('Failed to log ticket activity: %o', error);
      // Activity logging error should not crash main business action
      return null;
    }
  }

  /**
   * Retrieves timeline activities for a ticket with role-based filtering
   */
  async getActivitiesForTicket(ticketId, userRole = 'CUSTOMER') {
    let query = { ticketId };

    // If customer, filter out internal/staff-only activity events
    if (userRole === 'CUSTOMER') {
      query.action = { $nin: ['INTERNAL_NOTE', 'INTERNAL_NOTE_ADDED'] };
    }

    const activities = await TicketActivity.find(query)
      .sort({ createdAt: 1 })
      .populate('actorId', 'fullName email role');

    return activities;
  }
}

const ticketActivityService = new TicketActivityService();

module.exports = {
  TicketActivityService,
  ticketActivityService,
};
