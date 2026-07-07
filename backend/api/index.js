// نقطة الدخول بتاعة Vercel — كل الطلبات بتتوجّه هنا (شوف vercel.json rewrites)
// وبتتنفذ عن طريق نفس تطبيق Express اللي في app.js، من غير أي تغيير في المنطق.
const app = require("../app");

module.exports = app;
