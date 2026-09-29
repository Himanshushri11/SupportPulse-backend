const mongoose = require('mongoose');
const { Schema } = mongoose;
const { OtpPurpose } = require('../../constants/otp');

const otpSchema = new Schema(
  {
    identifier: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      required: true,
      enum: Object.values(OtpPurpose),
      index: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // MongoDB automatic TTL cleanup
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastSentAt: {
      type: Date,
      default: Date.now,
    },
    resendCount: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

otpSchema.index({ identifier: 1, purpose: 1 });

const Otp = mongoose.model('Otp', otpSchema);

module.exports = {
  Otp,
};
