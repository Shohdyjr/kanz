require("dotenv").config();
const app = require("./app");

const PORT = process.env.PORT || 3000;

// ملاحظة: مهمة node-cron الدورية شغالة هنا بس لو شغّلت السيرفر ده بنفسك
// (محليًا أو على Docker/Back4app). على Vercel، الجدولة بتتم بطريقة مختلفة
// تمامًا (Vercel Cron + رابط خارجي) — شوف vercel.json و routes/cron.js.
const { scheduleDailySnapshot } = require("./cron/dailySnapshot");
const { schedulePriceAlerts } = require("./cron/priceAlerts");

app.listen(PORT, () => {
  console.log(`✓ Kanz backend running on port ${PORT}`);
  scheduleDailySnapshot();
  schedulePriceAlerts();
});
