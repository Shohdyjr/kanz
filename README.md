# Kanz — دليل النشر الكامل

المشروع اتقسم لجزئين مستقلين تمامًا (زي أي تطبيق ويب احترافي):

```
kanz/
├── backend/     ← سيرفر Node.js + Express + PostgreSQL (بديل Google Apps Script)
└── frontend/    ← index.html (الواجهة، بتتصل بالسيرفر عبر REST API)
```

مفيش أي iframe ولا أي قفل على منصة جوجل — كل حاجة كود عادي قياسي (Node.js + Postgres) تقدر تشغّله وتنقله لأي سيرفر في أي وقت.

---

## الخطوة 1 — رفع المشروع على GitHub

```bash
cd kanz
git init
git add .
git commit -m "Initial commit: Kanz migrated off Google Apps Script"
```

روح على github.com واعمل repository جديد (مثلاً `kanz`)، وبعدين:

```bash
git remote add origin https://github.com/USERNAME/kanz.git
git branch -M main
git push -u origin main
```

> ملاحظة أمان مهمة: ملف `.env` متضافش أبدًا للـ commit (موجود جوه `.gitignore` أصلاً). لو حصل وحطيته بالغلط، غيّر كل الأسرار (JWT_SECRET، كلمات مرور SMTP، إلخ) فورًا.

---

## الخطوة 2 — نشر الباك إند (Render — مجاني)

1. روح على [render.com](https://render.com) واعمل حساب (تقدر تسجل بحساب GitHub مباشرة)
2. **New +** → **PostgreSQL** → اختار الخطة المجانية (Free) → أنشئ قاعدة البيانات
   - بعد الإنشاء، انسخ قيمة **Internal Database URL** (هتحتاجها في الخطوة الجاية)
3. **New +** → **Web Service** → اختار الـ repo بتاعك على GitHub
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - اختار الخطة المجانية (Free)
4. في تبويب **Environment**، ضيف كل المتغيرات من ملف `backend/.env.example`:
   - `DATABASE_URL` = رابط قاعدة البيانات اللي نسخته فوق
   - `JWT_SECRET` = نص عشوائي طويل (تقدر تولّده من [هنا](https://www.uuidgenerator.net) مثلاً)
   - `FRONTEND_ORIGIN` = رابط موقعك اللي هتاخده في الخطوة 3 (مؤقتًا سيبه `*` وارجعله بعد كده)
   - إعدادات SMTP لو عايز تنبيهات الإيميل تشتغل (اختياري)
5. اضغط **Create Web Service** — Render هيبني وينشر السيرفر تلقائيًا، وهيديك رابط زي:
   `https://kanz-backend-xxxx.onrender.com`

**ملحوظة عن الخطة المجانية:** السيرفر بينام بعد 15 دقيقة من غير استخدام، وأول طلب بعد النوم بياخد 30-60 ثانية عشان "يصحى" (Cold Start). ده طبيعي وموجود في كل استضافة مجانية فيها سيرفر حقيقي شغال — مش عيب في الكود.

*(البديل: [Koyeb](https://koyeb.com) بنفس الخطوات تقريبًا لو حبيت تجرب حاجة تانية)*

---

## الخطوة 3 — نشر الواجهة (Cloudflare Pages أو GitHub Pages)

### الخيار السريع: GitHub Pages
1. في إعدادات الـ repo على GitHub → **Settings → Pages**
2. **Source:** Deploy from a branch → اختار `main` والمجلد `/frontend`
3. هيديك رابط زي: `https://USERNAME.github.io/kanz/`

### الخيار الأفضل أداءً: Cloudflare Pages
1. روح [pages.cloudflare.com](https://pages.cloudflare.com) → **Create a project** → اربط حساب GitHub
2. اختار الـ repo → **Build output directory:** `frontend`
3. Deploy — هيديك رابط زي `kanz.pages.dev` (وتقدر تربط دومين خاص بيك مجانًا كمان)

### حاجة واحدة قبل النشر: وصّل الواجهة بالسيرفر
افتح `frontend/index.html` ودوّر على السطر ده (قريب من بداية الكود):

```js
const API_BASE = window.KANZ_API_BASE || "http://localhost:3000/api";
```

غيّره لرابط السيرفر بتاعك من الخطوة 2:

```js
const API_BASE = window.KANZ_API_BASE || "https://kanz-backend-xxxx.onrender.com/api";
```

اعمل commit وpush، وارجع لـ Render وحدّث `FRONTEND_ORIGIN` بالرابط النهائي للواجهة (عشان الـ CORS يشتغل صح).

---

## التشغيل محليًا (قبل النشر، للتجربة)

```bash
cd backend
cp .env.example .env     # واملأ القيم
npm install
npm start                # السيرفر هيشتغل على http://localhost:3000
```

وافتح `frontend/index.html` مباشرة في المتصفح (أو عبر أي static server محلي زي `npx serve frontend`).

---

## إيه اللي اتغيّر عن نسخة Apps Script القديمة؟

| القديم (Apps Script) | الجديد |
|---|---|
| تخزين البيانات في Google Sheet | جدول PostgreSQL حقيقي |
| تشفير الباسورد SHA-256 يدوي | bcrypt (معيار الصناعة) |
| نظام "تذكرني" بتوكن مخزّن يدويًا في الشيت | JWT ذاتي التحقق (مفيش حاجة متخزنة تتفحص كل مرة) |
| `ScriptApp` triggers | `node-cron` (نفس التوقيتات بالظبط: snapshot 3 فجرًا، تنبيهات كل 3 ساعات) |
| `MailApp.sendEmail` | `nodemailer` عبر أي SMTP تختاره |
| الموقع جوه iframe من جوجل | موقع مستقل تمامًا على دومينك |

منطق الحسابات نفسه (الأسعار، التحويلات، الـ snapshot) اتنقل زي ما هو بالظبط من غير أي تغيير — بس المكان اللي بيشتغل فيه اتغيّر.

## المرونة للمستقبل

الباك إند ده Node.js + Express + PostgreSQL قياسي 100%. يوم ما تحب تستضيفه بنفسك على VPS خاص بيك:

```bash
git clone https://github.com/USERNAME/kanz.git
cd kanz/backend
npm install
npm start
```

نفس الأمر بالظبط، على أي سيرفر في الدنيا — من غير إعادة كتابة سطر واحد.
