const { z } = require('zod');

const createMessageSchema = z.object({
  body: z
    .string({ required_error: 'Message body cannot be empty' })
    .trim()
    .min(1, 'Message body cannot be empty'),
  type: z
    .enum(['PUBLIC', 'INTERNAL', 'PUBLIC_REPLY', 'INTERNAL_NOTE'])
    .default('PUBLIC')
    .optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        originalName: z.string(),
        mimeType: z.string(),
        size: z.number(),
        url: z.string(),
      })
    )
    .default([])
    .optional(),
});

module.exports = {
  createMessageSchema,
};
