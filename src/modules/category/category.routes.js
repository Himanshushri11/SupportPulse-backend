const { Router } = require('express');
const { categoryController } = require('./category.controller');
const { authenticate, authorizeRoles } = require('../../middleware/auth');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');

const router = Router();

const createCategorySchema = z.object({
  name: z.string({ required_error: 'Category name is required' }).trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
});

// Public / Authenticated read for categories
router.get('/', categoryController.getCategories.bind(categoryController));

// Admin-only category creation
router.post(
  '/',
  authenticate,
  authorizeRoles('ADMIN'),
  validate(createCategorySchema),
  categoryController.createCategory.bind(categoryController)
);

// Admin-only category update
router.put(
  '/:id',
  authenticate,
  authorizeRoles('ADMIN'),
  validate(updateCategorySchema),
  categoryController.updateCategory.bind(categoryController)
);

// Admin-only category active status toggle
router.patch(
  '/:id/status',
  authenticate,
  authorizeRoles('ADMIN'),
  categoryController.toggleCategoryActive.bind(categoryController)
);

module.exports = router;
