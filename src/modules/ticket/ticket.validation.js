const { z } = require('zod');
const { TicketPriority, TicketStatus } = require('../../constants/ticket');

// Helper to validate MongoDB ObjectId format
const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const createTicketSchema = z.object({
  title: z
    .string({ required_error: 'Title is required' })
    .trim()
    .min(3, 'Title must be at least 3 characters')
    .max(200, 'Title cannot exceed 200 characters')
    .optional(),
  subject: z.string().trim().min(3).max(200).optional(),
  description: z
    .string({ required_error: 'Description is required' })
    .trim()
    .min(10, 'Please provide at least 10 characters describing your issue'),
  categoryId: z
    .string({ required_error: 'Category is required' })
    .regex(objectIdRegex, 'Invalid category identifier format')
    .optional(),
  category: z.string().regex(objectIdRegex).optional(),
  priority: z.enum(Object.values(TicketPriority)).default(TicketPriority.MEDIUM).optional(),
}).refine(
  (data) => data.title || data.subject,
  { message: 'Either title or subject is required', path: ['title'] }
).refine(
  (data) => data.categoryId || data.category,
  { message: 'Category is required', path: ['categoryId'] }
);

const updateTicketSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().min(10).optional(),
  categoryId: z.string().regex(objectIdRegex, 'Invalid category identifier format').optional(),
  priority: z.enum(Object.values(TicketPriority)).optional(),
});

const assignTicketSchema = z.object({
  agentId: z
    .string()
    .regex(objectIdRegex, 'Invalid agent identifier format')
    .nullable()
    .optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(Object.values(TicketStatus), {
    errorMap: () => ({ message: `Status must be one of: ${Object.values(TicketStatus).join(', ')}` }),
  }),
});

module.exports = {
  createTicketSchema,
  updateTicketSchema,
  assignTicketSchema,
  updateStatusSchema,
};
