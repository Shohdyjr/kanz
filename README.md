# Kanz

A personal wealth tracker (EGP, hard currency, gold, and other assets).

```
kanz/
├── backend/   Express + PostgreSQL API, deployed as Vercel serverless functions
│   └── test/  Unit tests (node:test) for the core money-math and auth logic
├── docs/      Static frontend, deployed on GitHub Pages
│   ├── index.html   Slim HTML shell (loads css/ and js/ below)
│   ├── css/         Extracted styles
│   └── js/          Vanilla JS split by concern (state, auth, render, history, …)
└── .github/workflows/ci.yml   Lint + format check + backend tests on every push/PR
```

No vendor lock-in: the backend is plain Node/Express/Postgres and can be moved
to any host (VPS, Docker, another serverless provider) without touching a
single line of application code.

## Stack

- **Frontend:** plain HTML/CSS/JS, no build step, no framework, no bundler.
  `docs/js/*.js` are loaded as ordinary (non-module) `<script>` tags in a
  fixed order — they intentionally share one global scope, the same way the
  original single-file version worked, just split by concern across files.
- **Backend:** Express, deployed on Vercel as serverless functions
- **Database:** PostgreSQL (tested against [Neon](https://neon.tech)'s free tier)
- **Auth:** JWT (stateless — no server-side session storage)
- **Scheduled jobs:** Vercel Cron — runs hourly and only executes the daily
  snapshot once it's ~3 AM in Cairo (`routes/cron.js`), so it isn't thrown off
  if Egypt's DST rules change again
- **Tooling:** ESLint (flat config) + Prettier at the repo root, `node:test`
  for backend unit tests, GitHub Actions CI running both on every push/PR

## Local development

```bash
cd backend
cp .env.example .env      # fill in DATABASE_URL and JWT_SECRET at minimum
npm install
npm run dev                # or `npm start`
npm test                   # run the unit test suite
```

Serve `docs/` with any static server (e.g. `npx serve docs`) — opening
`index.html` via `file://` won't work since it now loads `css/styles.css`
and the `js/*.js` files as separate requests. Set `window.KANZ_API_BASE`
before those scripts load (e.g. a small inline `<script>` in `index.html`)
to point at `http://localhost:3000/api`.

## Linting & formatting

```bash
npm install     # at the repo root — installs ESLint + Prettier only
npm run lint          # ESLint across backend/ and docs/js/
npm run format        # Prettier --check
npm run format:fix    # Prettier --write
```

CI (`.github/workflows/ci.yml`) runs both of these plus `npm test` in
`backend/` on every push and pull request.

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

Update `API_BASE` in `docs/js/api.js` to your Vercel URL + `/api`
(or set `window.KANZ_API_BASE` in `docs/index.html` before the other scripts load).

### 4. Scheduling

The daily 3 AM wealth snapshot runs automatically via Vercel Cron (configured
in `vercel.json`, protected by `CRON_SECRET`). No external service needed.

## Security notes

- Passwords are hashed with bcrypt.
- Auth endpoints are rate-limited (20 requests / 15 min / IP).
- `helmet` sets standard security headers; JSON body size is capped at 100kb.
- The cron secret is compared using `crypto.timingSafeEqual` to avoid timing
  attacks.
- `JWT_SECRET` and `DATABASE_URL` are required at boot — the process fails
  fast instead of silently running with an undefined secret.
- Set `FRONTEND_ORIGIN` to your real frontend URL in production; leaving it
  as `*` allows any site to call the API.
- `PUT /api/data` rejects `qty` unless every value is a finite number (not
  just "an object"), since a stray string/NaN would silently corrupt every
  downstream money calculation.
- Gold price is fetched from two independent free sources; if both are down,
  the last successfully-fetched price is reused from a small Postgres cache
  (`kanz_settings`) instead of failing the whole rates fetch (and, on the
  daily snapshot cron, failing every user's snapshot for the day).
