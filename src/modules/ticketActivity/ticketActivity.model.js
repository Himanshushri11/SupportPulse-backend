const mongoose = require('mongoose');
const { Schema } = mongoose;

const ticketActivitySchema = new Schema(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
      index: true,
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    actorEmail: {
      type: String,
      lowercase: true,
      trim: true,
    },
    actorRole: {
      type: String,
      default: 'SYSTEM',
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    oldValue: {
      type: String,
      default: null,
    },
    newValue: {
      type: String,
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
    },
  }
);

// Virtual for actor details
ticketActivitySchema.virtual('actor', {
  ref: 'User',
  localField: 'actorId',
  foreignField: '_id',
  justOne: true,
});

// Virtual for ticket
ticketActivitySchema.virtual('ticket', {
  ref: 'Ticket',
  localField: 'ticketId',
  foreignField: '_id',
  justOne: true,
});

// Virtual for type (alias for action)
ticketActivitySchema.virtual('type').get(function () {
  return this.action;
});

// Index for chronological timeline retrieval per ticket
ticketActivitySchema.index({ ticketId: 1, createdAt: 1 });

const TicketActivity = mongoose.model('TicketActivity', ticketActivitySchema);

module.exports = {
  TicketActivity,
};
