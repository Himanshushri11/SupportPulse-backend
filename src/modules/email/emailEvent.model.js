const mongoose = require('mongoose');
const { Schema } = mongoose;
const { EmailDirection, EmailEventStatus } = require('../../constants/ticket');

const emailEventSchema = new Schema(
  {
    providerMessageId: {
      type: String,
      sparse: true,
      index: true,
      trim: true,
    },
    messageId: {
      type: String,
      sparse: true,
      index: true,
      trim: true,
    },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: 'Ticket',
      default: null,
      index: true,
    },
    direction: {
      type: String,
      enum: Object.values(EmailDirection),
      default: EmailDirection.INBOUND,
      index: true,
    },
    sender: {
      type: String,
      lowercase: true,
      trim: true,
    },
    recipient: {
      type: String,
      lowercase: true,
      trim: true,
    },
    subject: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(EmailEventStatus),
      default: EmailEventStatus.RECEIVED,
      index: true,
    },
    error: {
      type: String,
      default: null,
    },
    headers: {
      type: Schema.Types.Mixed,
      default: {},
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Idempotency compound index for duplicate inbound message detection
emailEventSchema.index({ messageId: 1, direction: 1 }, { sparse: true });

const EmailEvent = mongoose.model('EmailEvent', emailEventSchema);

module.exports = {
  EmailEvent,
};
