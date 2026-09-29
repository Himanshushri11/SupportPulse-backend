const { TicketStatus, ActivityAction } = require('../../constants/ticket');
const { BadRequestError, ForbiddenError } = require('../../utils/errors');

/**
 * Strict Transition Rules Matrix
 * Key: currentStatus
 * Value: Map of allowed targetStatus -> array of authorized roles
 * Note: 'CUSTOMER_OWNER' requires the actor to be the ticket's requester.
 */
const ALLOWED_TRANSITIONS = {
  [TicketStatus.OPEN]: {
    [TicketStatus.IN_PROGRESS]: ['AGENT', 'ADMIN'],
    [TicketStatus.PENDING]: ['AGENT', 'ADMIN'],
    [TicketStatus.CLOSED]: ['CUSTOMER_OWNER', 'AGENT', 'ADMIN'],
  },
  [TicketStatus.IN_PROGRESS]: {
    [TicketStatus.PENDING]: ['AGENT', 'ADMIN'],
    [TicketStatus.RESOLVED]: ['AGENT', 'ADMIN'],
    [TicketStatus.CLOSED]: ['AGENT', 'ADMIN'],
  },
  [TicketStatus.PENDING]: {
    [TicketStatus.IN_PROGRESS]: ['CUSTOMER_OWNER', 'AGENT', 'ADMIN'],
    [TicketStatus.RESOLVED]: ['AGENT', 'ADMIN'],
    [TicketStatus.CLOSED]: ['AGENT', 'ADMIN'],
  },
  [TicketStatus.RESOLVED]: {
    [TicketStatus.OPEN]: ['CUSTOMER_OWNER', 'AGENT', 'ADMIN'],
    [TicketStatus.REOPENED]: ['CUSTOMER_OWNER', 'AGENT', 'ADMIN'],
    [TicketStatus.CLOSED]: ['CUSTOMER_OWNER', 'AGENT', 'ADMIN'],
  },
  [TicketStatus.CLOSED]: {
    [TicketStatus.OPEN]: ['CUSTOMER_OWNER', 'AGENT', 'ADMIN'],
    [TicketStatus.REOPENED]: ['CUSTOMER_OWNER', 'AGENT', 'ADMIN'],
  },
  [TicketStatus.REOPENED]: {
    [TicketStatus.IN_PROGRESS]: ['AGENT', 'ADMIN'],
    [TicketStatus.PENDING]: ['AGENT', 'ADMIN'],
    [TicketStatus.RESOLVED]: ['AGENT', 'ADMIN'],
    [TicketStatus.CLOSED]: ['AGENT', 'ADMIN'],
  },
};

class TicketStateMachine {
  /**
   * Validates if a state transition is legal and authorized for the actor
   */
  validateTransition(currentStatus, targetStatus, user, isOwner = false) {
    if (currentStatus === targetStatus) {
      return true;
    }

    const availableTransitions = ALLOWED_TRANSITIONS[currentStatus];
    if (!availableTransitions || !availableTransitions[targetStatus]) {
      const allowedNext = availableTransitions ? Object.keys(availableTransitions).join(', ') : 'None';
      throw new BadRequestError(
        `Invalid status transition from '${currentStatus}' to '${targetStatus}'. Allowed next states: [${allowedNext}]`
      );
    }

    const allowedRoles = availableTransitions[targetStatus];

    // Admin has global authority if ADMIN is permitted
    if (user.role === 'ADMIN' && allowedRoles.includes('ADMIN')) {
      return true;
    }

    // Agent authority check
    if (user.role === 'AGENT' && allowedRoles.includes('AGENT')) {
      return true;
    }

    // Customer authority check (strictly requires ownership)
    if (user.role === 'CUSTOMER') {
      if (allowedRoles.includes('CUSTOMER_OWNER')) {
        if (!isOwner) {
          throw new ForbiddenError('Only the original ticket requester can perform this transition');
        }
        return true;
      }
    }

    throw new ForbiddenError(
      `Role '${user.role}' is not authorized to transition ticket from '${currentStatus}' to '${targetStatus}'`
    );
  }

  /**
   * Applies the validated transition to a ticket document and updates relevant lifecycle timestamps
   */
  applyTransition(ticket, targetStatus, user, isOwner = false) {
    this.validateTransition(ticket.status, targetStatus, user, isOwner);

    const previousStatus = ticket.status;
    ticket.status = targetStatus;

    // Update state-specific timestamps
    const now = new Date();
    if (targetStatus === TicketStatus.RESOLVED) {
      ticket.resolvedAt = now;
    } else if (targetStatus === TicketStatus.CLOSED) {
      ticket.closedAt = now;
    } else if (
      targetStatus === TicketStatus.REOPENED ||
      (targetStatus === TicketStatus.OPEN &&
        (previousStatus === TicketStatus.RESOLVED || previousStatus === TicketStatus.CLOSED))
    ) {
      ticket.reopenedAt = now;
      ticket.resolvedAt = null;
      ticket.closedAt = null;
    } else if (
      targetStatus === TicketStatus.IN_PROGRESS &&
      (previousStatus === TicketStatus.OPEN || previousStatus === TicketStatus.REOPENED)
    ) {
      if (!ticket.assignedAt && ticket.assignedTo) {
        ticket.assignedAt = now;
      }
    }

    // Determine corresponding activity action
    let action = ActivityAction.STATUS_CHANGED;
    if (targetStatus === TicketStatus.RESOLVED) {
      action = ActivityAction.TICKET_RESOLVED;
    } else if (
      targetStatus === TicketStatus.REOPENED ||
      (targetStatus === TicketStatus.OPEN &&
        (previousStatus === TicketStatus.RESOLVED || previousStatus === TicketStatus.CLOSED))
    ) {
      action = ActivityAction.TICKET_REOPENED;
    } else if (targetStatus === TicketStatus.CLOSED) {
      action = ActivityAction.TICKET_CLOSED;
    }

    return {
      previousStatus,
      newStatus: targetStatus,
      action,
    };
  }
}

const ticketStateMachine = new TicketStateMachine();

module.exports = {
  TicketStateMachine,
  ticketStateMachine,
  ALLOWED_TRANSITIONS,
};
