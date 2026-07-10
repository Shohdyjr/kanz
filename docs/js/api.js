// ════════════════════════════════════════════════════════
//  Connecting to the backend (Node.js + Express + PostgreSQL)
//  ─────────────────────────────────────────────────────
//  A thin REST client used by every data-loading/saving call below.
//  Kept as a single small layer so the transport can change (e.g. hosting
//  provider) without touching the call sites that use it.
// ════════════════════════════════════════════════════════

// Change this to your deployed server URL (see README for deployment)
const API_BASE = window.KANZ_API_BASE || "https://kanz-snowy.vercel.app/api";

// Map: RPC-style name → the actual REST call to the server
const RPC_MAP = {
  signUp: (u, p, email) => ({ method: "POST", path: "/auth/signup", body: { username: u, password: p, email } }),
  logIn: (u, p) => ({ method: "POST", path: "/auth/login", body: { username: u, password: p } }),
  loginWithToken: (u, tok) => ({ method: "POST", path: "/auth/verify", body: { token: tok } }),
  forgotPassword: (u) => ({ method: "POST", path: "/auth/forgot-password", body: { username: u } }),
  resetPassword: (u, otp, newPassword) => ({
    method: "POST",
    path: "/auth/reset-password",
    body: { username: u, otp, newPassword },
  }),
  updateEmail: (email, tok) => ({ method: "PUT", path: "/auth/email", bearer: tok, body: { email } }),
  loadDataForClient: (u, tok) => ({ method: "GET", path: "/data", bearer: tok }),
  saveDataFromClient: (u, qty, ca, ex, ov, th, lg, ord, goal, tok, apyMap) => ({
    method: "PUT",
    path: "/data",
    bearer: tok,
    body: {
      qty,
      customAssets: ca,
      excludedBaseIds: ex,
      baseOverrides: ov,
      theme: th,
      lang: lg,
      order: ord,
      savingsGoal: goal,
      apy: apyMap,
    },
  }),
  loadItemHistoryForClient: (u, itemId, tok) => ({
    method: "GET",
    path: "/item-history" + (itemId ? "?itemId=" + encodeURIComponent(itemId) : ""),
    bearer: tok,
  }),
  loadHistoryForClient: (u, tok) => ({ method: "GET", path: "/history", bearer: tok }),
  addManualHistoryEntry: (u, entry, tok) => ({ method: "POST", path: "/history", bearer: tok, body: { entry } }),
  deleteHistoryEntry: (u, date, tok) => ({ method: "DELETE", path: "/history", bearer: tok, body: { date } }),
  loadContributionsForClient: (u, tok) => ({ method: "GET", path: "/contributions", bearer: tok }),
  addContribution: (u, entry, tok) => ({ method: "POST", path: "/contributions", bearer: tok, body: entry }),
  deleteContribution: (u, date, tok) => ({ method: "DELETE", path: "/contributions", bearer: tok, body: { date } }),
  getHistoricalRate: (dateStr) => ({ method: "GET", path: "/historical-rate?date=" + encodeURIComponent(dateStr) }),
  fetchBenchmarkSeries: (from, to) => ({
    method: "GET",
    path: "/benchmark?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to),
  }),
};

async function rpcCall(fnName, args) {
  const build = RPC_MAP[fnName];
  if (!build) throw new Error("Unknown RPC: " + fnName);
  const cfg = build(...args);
  const headers = { "Content-Type": "application/json" };
  if (cfg.bearer) headers["Authorization"] = "Bearer " + cfg.bearer;
  const res = await fetch(API_BASE + cfg.path, {
    method: cfg.method,
    headers,
    cache: "no-store", // never let the browser serve a stale cached response for personal data
    body: cfg.method !== "GET" ? JSON.stringify(cfg.body || {}) : undefined,
  });
  return res.json();
}

// Small wrapper exposing an RPC-style call for each backend function name.
// Every call site below simply awaits rpcCall("functionName", [...args]).

function makeRpcProxy(onSuccess, onFailure) {
  return new Proxy(
    {},
    {
      get(_target, fnName) {
        return (...args) => {
          rpcCall(fnName, args)
            .then(onSuccess)
            .catch((err) => {
              if (onFailure) onFailure(err);
            });
        };
      },
    }
  );
}

// Legacy-style callback wrapper, kept so every call site below reads as
// `rpc.run.withSuccessHandler(...).withFailureHandler(...).functionName(args)`
// without each one needing its own .then()/.catch() boilerplate.
const rpc = {
  run: {
    withSuccessHandler(onSuccess) {
      return { withFailureHandler: (onFailure) => makeRpcProxy(onSuccess, onFailure) };
    },
    withFailureHandler(onFailure) {
      return { withSuccessHandler: (onSuccess) => makeRpcProxy(onSuccess, onFailure) };
    },
  },
};
