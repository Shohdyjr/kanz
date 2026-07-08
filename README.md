# Kanz

A personal wealth tracker (EGP, hard currency, gold, and other assets), originally
built as a Google Apps Script app and migrated to a standard Node.js stack.

```
kanz/
├── backend/   Express + PostgreSQL API, deployed as Vercel serverless functions
└── docs/      Static frontend (index.html), deployed on GitHub Pages
```

No vendor lock-in: the backend is plain Node/Express/Postgres and can be moved
to any host (VPS, Docker, another serverless provider) without touching a
single line of application code.

## Stack

- **Frontend:** single-file HTML/CSS/JS, no build step, no framework
- **Backend:** Express, deployed on Vercel as serverless functions
- **Database:** PostgreSQL (tested against [Neon](https://neon.tech)'s free tier)
- **Auth:** JWT (stateless — no server-side session storage)
- **Scheduled jobs:** Vercel Cron — one daily run for the 3 AM wealth snapshot

## Local development

```bash
cd backend
cp .env.example .env      # fill in DATABASE_URL and JWT_SECRET at minimum
npm install
npm run dev                # or `npm start`
```

Open `docs/index.html` directly in a browser (or serve it with `npx serve docs`),
and update `API_BASE` near the top of its `<script>` tag to
`http://localhost:3000/api`.

## Deployment

### 1. Database — Neon (free, no card required)
Create a project at [neon.tech](https://neon.tech) and copy its connection
string into `DATABASE_URL`.

### 2. Backend — Vercel (free, no card required)
1. Import the GitHub repo on [vercel.com](https://vercel.com)
2. Set **Root Directory** to `backend`
3. Add environment variables: `DATABASE_URL`, `JWT_SECRET`, `CRON_SECRET`,
   `FRONTEND_ORIGIN` (see `.env.example` for the full list)
4. Deploy — Vercel assigns a permanent domain like `your-app.vercel.app`

### 3. Frontend — GitHub Pages
Settings → Pages → Deploy from branch `main`, folder `/docs`.

Update `API_BASE` in `docs/index.html` to your Vercel URL + `/api`.

### 4. Scheduling
The daily 3 AM wealth snapshot runs automatically via Vercel Cron (configured
in `vercel.json`, protected by `CRON_SECRET`). No external service needed.

## Security notes

- Passwords are hashed with bcrypt; a `legacy_hash` column supports
  transparent upgrade of accounts migrated from the old SHA-256-based
  Apps Script version.
- Auth endpoints are rate-limited (20 requests / 15 min / IP).
- `helmet` sets standard security headers; JSON body size is capped at 100kb.
- The cron secret is compared using `crypto.timingSafeEqual` to avoid timing
  attacks.
- `JWT_SECRET` and `DATABASE_URL` are required at boot — the process fails
  fast instead of silently running with an undefined secret.
- Set `FRONTEND_ORIGIN` to your real frontend URL in production; leaving it
  as `*` allows any site to call the API.

## Migrating data from the old Google Sheets version

Export the old `kanz_users` sheet as **Tab Separated Values (.tsv)** and
insert each row directly into `kanz_users` via Neon's SQL Editor, or in bulk
with a small script — see the "Migrating an old account" section in project
history/issues for the exact column mapping (`username | password_hash |
created_at | data_json | history_json`). Old password hashes are preserved
in the `legacy_hash` column and upgraded to bcrypt automatically on first
login.
