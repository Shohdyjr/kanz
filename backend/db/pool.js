const { Pool } = require("pg");

// Render/Koyeb/Supabase بيدّوا رابط قاعدة بيانات بيحتاج SSL غالبًا.
// rejectUnauthorized:false مقبول هنا لأننا بنتعامل مع مزودين موثوقين
// وده نفس الإعداد اللي بيوصوا بيه في توثيق Render.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

module.exports = pool;
