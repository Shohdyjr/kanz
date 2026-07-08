// ════════════════════════════════════════════════════════
//  Auth Functions (Login / Sign up / Logout)
// ════════════════════════════════════════════════════════

function renderAuth() {
  const logoSvg = `<svg viewBox="0 0 100 100">
    <g transform="translate(50,50)">
      <polygon points="0,-42 42,0 0,42 -42,0" fill="none" stroke="var(--wt-gold)" stroke-width="2.5" stroke-linejoin="round"/>
      <polygon points="0,-30 30,0 0,30 -30,0" fill="none" stroke="var(--wt-gold-dim)" stroke-width="1" stroke-linejoin="round"/>
      <text x="-1" y="8" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="22" font-weight="700" fill="var(--wt-gold-light)">K</text>
      <text x="1" y="7" text-anchor="start" font-family="JetBrains Mono, monospace" font-size="10" font-weight="700" fill="var(--wt-gold-light)">ANZ</text>
    </g>
  </svg>`;

  const isLogin = authMode === "login";
  const appEl = document.getElementById("app");
  if (!appEl) return;

  appEl.innerHTML = `
  <div class="wt-auth-screen">
    <div class="wt-auth-toggles">
      <button class="wt-theme-btn" onclick="toggleLang()" title="${lang === "en" ? "التبديل للعربي" : "Switch to English"}">${lang === "ar" ? "EN" : "AR"}</button>
      <button class="wt-theme-btn" onclick="toggleTheme()" title="${lang === "en" ? "Toggle theme" : "تبديل المظهر"}">${themeIconSvg()}</button>
    </div>
    <div class="wt-auth-card">
      <div class="wt-auth-logo">
        ${logoSvg}
        <div>
          <div class="wt-auth-logo-name">KANZ</div>
          <div class="wt-auth-logo-sub">${t("authTagline")}</div>
        </div>
      </div>
      <div class="wt-auth-tabs">
        <button class="wt-auth-tab ${isLogin ? "active" : ""}" onclick="authMode='login';renderAuth()">${lang === "en" ? "Login" : "تسجيل دخول"}</button>
        <button class="wt-auth-tab ${!isLogin ? "active" : ""}" onclick="authMode='signup';renderAuth()">${lang === "en" ? "Sign up" : "حساب جديد"}</button>
      </div>
      <form id="auth-form" onsubmit="submitAuth(event)">
        <div class="wt-field">
          <label for="auth-username">${lang === "en" ? "Username" : "اسم المستخدم"}</label>
          <input type="text" id="auth-username" name="kanz_login_username" placeholder="${lang === "en" ? "e.g. ahmed123" : "مثال: ahmed123"}" autocomplete="username" dir="ltr" style="text-transform:lowercase">
        </div>
        <div class="wt-field">
          <label for="auth-password">${lang === "en" ? "Password" : "الباسورد"}</label>
          <input type="password" id="auth-password" name="kanz_login_password" placeholder="${lang === "en" ? "at least 4 characters" : "٤ أحرف على الأقل"}" autocomplete="${isLogin ? "current-password" : "new-password"}" dir="ltr">
        </div>
        <p id="auth-err" class="wt-auth-err"></p>
        <label class="wt-auth-remember">
          <input type="checkbox" id="auth-remember-me" checked>
          <span>${t("rememberMe")}</span>
        </label>
        <button type="submit" class="wt-auth-btn" id="auth-submit-btn">
          ${isLogin ? (lang === "en" ? "Login" : "دخول") : lang === "en" ? "Create account" : "إنشاء حساب"}
        </button>
      </form>
    </div>
  </div>`;
}

function submitAuth(ev) {
  if (ev) ev.preventDefault();
  const username = (document.getElementById("auth-username").value || "").trim().toLowerCase();
  const password = document.getElementById("auth-password").value || "";
  const btn = document.getElementById("auth-submit-btn");
  const errEl = document.getElementById("auth-err");

  errEl.style.display = "none";
  btn.disabled = true;
  btn.textContent = "…";

  const fn = authMode === "login" ? "logIn" : "signUp";
  rpc.run
    .withSuccessHandler(function (j) {
      btn.disabled = false;
      if (j.ok) {
        completeLogin(j.username, j.token, j.expiresAt);
      } else {
        errEl.textContent = j.error ? t(j.error) : t("genericError");
        errEl.style.display = "block";
        btn.disabled = false;
        btn.textContent =
          authMode === "login" ? (lang === "en" ? "Login" : "دخول") : lang === "en" ? "Create account" : "إنشاء حساب";
      }
    })
    .withFailureHandler(function (err) {
      btn.disabled = false;
      errEl.textContent = t("connectionError");
      errEl.style.display = "block";
      btn.textContent = "⚠";
    })
    [fn](username, password);
}

// Called after any successful login/signup. Waits for the session token
// before loading any data, guaranteeing every subsequent server request
// already has a valid token from the very first moment.
async function completeLogin(username, token, expiresAt) {
  currentUser = username;
  sessionToken = token; // returned directly from the signUp/logIn response, no extra round trip needed
  try {
    sessionStorage.setItem("kanz_user", currentUser);
  } catch (e) {}

  const rememberEl = document.getElementById("auth-remember-me");
  const persist = !!(rememberEl && rememberEl.checked);
  if (!persist) {
    try {
      localStorage.removeItem("kanz_remember");
    } catch (e) {}
  } else if (token) {
    try {
      localStorage.setItem("kanz_remember", JSON.stringify({ username: username, token: token, expiresAt: expiresAt }));
    } catch (e) {}
  }

  // Full state reset to avoid leaking data from a previous user
  qty = {};
  order = [];
  customAssets = [];
  excludedBaseIds = new Set();
  baseOverrides = {};
  historyData = [];
  theme = "dark";
  lang = "en";
  savingsGoal = 0;
  ASSETS.forEach((a) => (qty[a.id] = 0));
  render();
  fetchRates();
  sheetsLoad();
  loadHistory();
}

function logout() {
  // JWTs are self-verifying — there's no server-side session to revoke,
  // so clearing the local copy is entirely sufficient.
  currentUser = null;
  sessionToken = null;
  try {
    sessionStorage.removeItem("kanz_user");
  } catch (e) {}
  try {
    localStorage.removeItem("kanz_remember");
  } catch (e) {}
  qty = {};
  order = [];
  customAssets = [];
  excludedBaseIds = new Set();
  baseOverrides = {};
  historyData = [];
  historyChart = null;
  outerChart = null;
  innerChart = null;
  savingsGoal = 0;
  goalModalOpen = false;
  authMode = "login";
  renderAuth();
}

// ── "Remember me" (7 days) ───────────────────────────────
// After a successful login, we request a fresh token from the server and
// store it in localStorage. Next time the user opens the site, we try to
// verify that token automatically before ever showing the login screen.

function attemptAutoLogin() {
  let saved = null;
  try {
    const raw = localStorage.getItem("kanz_remember");
    if (raw) saved = JSON.parse(raw);
  } catch (e) {}

  if (!saved || !saved.username || !saved.token) {
    render(); // no saved token — show the login screen as usual
    return;
  }

  // Simple loading screen while we verify the token with the server
  const appEl = document.getElementById("app");
  if (appEl) {
    appEl.innerHTML = `<div class="wt-auth-screen"><div class="wt-status"><span class="wt-dot loading"></span><span>${t("signingIn")}</span></div></div>`;
  }

  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok) {
        currentUser = j.username;
        sessionToken = saved.token; // same saved token, now confirmed valid
        try {
          sessionStorage.setItem("kanz_user", currentUser);
        } catch (e) {}
        qty = {};
        order = [];
        customAssets = [];
        excludedBaseIds = new Set();
        baseOverrides = {};
        historyData = [];
        ASSETS.forEach((a) => (qty[a.id] = 0));
        render();
        fetchRates();
        sheetsLoad();
        loadHistory();
      } else {
        try {
          localStorage.removeItem("kanz_remember");
        } catch (e) {}
        render();
      }
    })
    .withFailureHandler(function () {
      try {
        localStorage.removeItem("kanz_remember");
      } catch (e) {}
      render();
    })
    .loginWithToken(saved.username, saved.token);
}

// ── Loading data from the backend ─────────
// Response shape: { ok, data, customAssets, excludedBaseIds, baseOverrides }
function sheetsLoad() {
  if (!currentUser) return;
  isLoadingData = true; // block scheduleSave while loading
  syncStatus = "loading";
  renderSyncBadge();
  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok) {
        if (Array.isArray(j.customAssets)) customAssets = j.customAssets;
        if (Array.isArray(j.excludedBaseIds)) excludedBaseIds = new Set(j.excludedBaseIds);
        if (j.baseOverrides && typeof j.baseOverrides === "object") baseOverrides = j.baseOverrides;
        if (j.theme === "light" || j.theme === "dark") theme = j.theme;
        if (j.lang === "ar" || j.lang === "en") lang = j.lang;
        savingsGoal = typeof j.savingsGoal === "number" ? j.savingsGoal : 0;

        rebuildAssets();
        order = Array.isArray(j.order) && j.order.length ? j.order : ASSETS.map((a) => a.id);
        syncOrderWithAssets();

        if (j.data) {
          ASSETS.forEach((a) => {
            const v = parseFloat(j.data[a.id]);
            if (!isNaN(v)) qty[a.id] = v;
          });
        }
      }
      isLoadingData = false;
      syncStatus = "synced";
      applyTheme();
      applyLang();
      render();
      renderBreakdown();
    })
    .withFailureHandler(function (err) {
      isLoadingData = false;
      syncStatus = "error";
      console.error("sheetsLoad:", err);
      render();
      renderBreakdown();
    })
    .loadDataForClient(currentUser, sessionToken);
}
