const sendResponse = (res, statusCode, payload) => {
  return res.status(statusCode).json({
    success: payload.success,
    message: payload.message,
    data: payload.data,
    meta: payload.meta,
    errors: payload.errors,
  });
};

const sendSuccess = (res, data, message, statusCode = 200, meta) => {
  return sendResponse(res, statusCode, {
    success: true,
    message,
    data,
    meta,
  });
};

const sendCreated = (res, data, message = 'Resource created successfully') => {
  return sendSuccess(res, data, message, 201);
};

module.exports = {
  sendResponse,
  sendSuccess,
  sendCreated,
};
