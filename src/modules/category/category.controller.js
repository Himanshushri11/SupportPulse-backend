const { Category } = require('./category.model');
const { sendSuccess, sendCreated } = require('../../utils/response');
const { ConflictError, NotFoundError } = require('../../utils/errors');

const DEFAULT_CATEGORIES = [
  { name: 'Technical Support', description: 'Technical errors, bugs, performance issues, and integrations.' },
  { name: 'Billing & Invoices', description: 'Payment processing, invoice queries, subscription renewals, and refunds.' },
  { name: 'Account & Access', description: 'Sign-in trouble, OTP verification, security, and permissions.' },
  { name: 'General Inquiries', description: 'Product capabilities, enterprise plans, and questions.' },
  { name: 'Other', description: 'General support requests not covered by other classifications.' },
];

class CategoryController {
  /**
   * Get all active categories (auto-seeds defaults if collection is empty)
   */
  async getCategories(req, res, next) {
    try {
      let categories = await Category.find({ isActive: true }).sort({ name: 1 });

      if (categories.length === 0) {
        for (const cat of DEFAULT_CATEGORIES) {
          await Category.updateOne({ name: cat.name }, { $setOnInsert: cat }, { upsert: true });
        }
        categories = await Category.find({ isActive: true }).sort({ name: 1 });
      }

      return sendSuccess(res, { categories }, 'Categories retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new category (Admin only)
   */
  async createCategory(req, res, next) {
    try {
      const { name, description } = req.body;
      const existing = await Category.findOne({ name: name.trim() });
      if (existing) {
        throw new ConflictError(`Category '${name.trim()}' already exists`);
      }

      const category = await Category.create({
        name: name.trim(),
        description: description ? description.trim() : '',
        isActive: true,
      });

      return sendCreated(res, { category }, 'Category created successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update category details (Admin only)
   */
  async updateCategory(req, res, next) {
    try {
      const { id } = req.params;
      const { name, description, isActive } = req.body;

      const category = await Category.findById(id);
      if (!category) {
        throw new NotFoundError('Category not found');
      }

      if (name && name.trim() !== category.name) {
        const existing = await Category.findOne({
          name: name.trim(),
          _id: { $ne: category._id },
        });
        if (existing) {
          throw new ConflictError(`Category '${name.trim()}' already exists`);
        }
        category.name = name.trim();
      }

      if (description !== undefined) {
        category.description = description.trim();
      }

      if (typeof isActive === 'boolean') {
        category.isActive = isActive;
      }

      await category.save();

      return sendSuccess(res, { category }, 'Category updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Toggle or set active status of category (Admin only)
   */
  async toggleCategoryActive(req, res, next) {
    try {
      const { id } = req.params;
      const category = await Category.findById(id);
      if (!category) {
        throw new NotFoundError('Category not found');
      }

      category.isActive = typeof req.body.isActive === 'boolean' ? req.body.isActive : !category.isActive;
      await category.save();

      return sendSuccess(
        res,
        { category },
        `Category ${category.isActive ? 'activated' : 'deactivated'} successfully`
      );
    } catch (error) {
      next(error);
    }
  }
}

const categoryController = new CategoryController();

module.exports = {
  CategoryController,
  categoryController,
};
