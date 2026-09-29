const mongoose = require('mongoose');
const { Schema } = mongoose;
const { MessageSource, MessageType } = require('../../constants/ticket');

const attachmentSchema = new Schema(
  {
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    url: { type: String, required: true },
  },
  { _id: false }
);

const ticketMessageSchema = new Schema(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: 'Ticket',
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    senderEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    senderRole: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['PUBLIC', 'INTERNAL', 'PUBLIC_REPLY', 'INTERNAL_NOTE', 'REPLY', 'SYSTEM', 'SYSTEM_EVENT'],
      default: MessageType.PUBLIC,
      index: true,
    },
    body: {
      type: String,
      required: [true, 'Message body is required'],
      trim: true,
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    source: {
      type: String,
      enum: Object.values(MessageSource),
      default: MessageSource.WEB,
    },
    emailMessageId: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
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

// Virtual for ticket
ticketMessageSchema.virtual('ticket', {
  ref: 'Ticket',
  localField: 'ticketId',
  foreignField: '_id',
  justOne: true,
});

// Virtual for sender details
ticketMessageSchema.virtual('sender', {
  ref: 'User',
  localField: 'senderId',
  foreignField: '_id',
  justOne: true,
});

// Virtual for message body alias
ticketMessageSchema.virtual('message').get(function () {
  return this.body;
}).set(function (val) {
  this.body = val;
});

// Virtual for messageType
ticketMessageSchema.virtual('messageType').get(function () {
  if (this.type === 'INTERNAL' || this.type === 'INTERNAL_NOTE') return 'INTERNAL_NOTE';
  if (this.type === 'SYSTEM' || this.type === 'SYSTEM_EVENT') return 'SYSTEM';
  return 'REPLY';
});

// Virtual for visibility
ticketMessageSchema.virtual('visibility').get(function () {
  return this.type === 'INTERNAL' || this.type === 'INTERNAL_NOTE' ? 'INTERNAL' : 'PUBLIC';
});

// Compound index for fast chronological conversation querying with type filtering
ticketMessageSchema.index({ ticketId: 1, type: 1, createdAt: 1 });

const TicketMessage = mongoose.model('TicketMessage', ticketMessageSchema);

module.exports = {
  TicketMessage,
};
