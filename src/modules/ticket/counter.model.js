const mongoose = require('mongoose');
const { Schema } = mongoose;

const counterSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  seq: {
    type: Number,
    default: 0,
  },
});

const Counter = mongoose.model('Counter', counterSchema);

/**
 * Atomically generates the next formatted ticket number: TKT-YYYY-XXXXXX
 */
async function getNextTicketNumber() {
  const currentYear = new Date().getFullYear();
  const counterName = `ticket_${currentYear}`;

  const counter = await Counter.findOneAndUpdate(
    { name: counterName },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  const paddedSeq = String(counter.seq).padStart(6, '0');
  return `TKT-${currentYear}-${paddedSeq}`;
}

module.exports = {
  Counter,
  getNextTicketNumber,
};
