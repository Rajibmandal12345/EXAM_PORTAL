// ================== EDIT THESE ==================
module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASS: process.env.ADMIN_PASS || 'wbjee@2026',   // <-- CHANGE THIS before the real exam
  DATA_DIR: process.env.DATA_DIR || require('path').join(__dirname, 'data'),
  MAX_BODY: 2 * 1024 * 1024
};
