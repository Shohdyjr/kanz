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

  const appEl = document.getElementById("app");
  if (!appEl) return;

  const isForgotFlow = authMode === "forgot" || authMode === "resetOtp";
  const isLogin = authMode === "login";

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
      ${
        isForgotFlow
          ? ""
          : `<div class="wt-auth-tabs">
        <button class="wt-auth-tab ${isLogin ? "active" : ""}" onclick="authMode='login';renderAuth()">${lang === "en" ? "Login" : "تسجيل دخول"}</button>
        <button class="wt-auth-tab ${!isLogin ? "active" : ""}" onclick="authMode='signup';renderAuth()">${lang === "en" ? "Sign up" : "حساب جديد"}</button>
      </div>`
      }
      ${
        authMode === "forgot"
          ? renderForgotForm()
          : authMode === "resetOtp"
            ? renderResetOtpForm()
            : renderLoginSignupForm(isLogin)
      }
    </div>
  </div>`;
}

function renderLoginSignupForm(isLogin) {
  return `
      <form id="auth-form" onsubmit="submitAuth(event)">
        <div class="wt-field">
          <label for="auth-username">${lang === "en" ? "Username" : "اسم المستخدم"}</label>
          <input type="text" id="auth-username" name="kanz_login_username" placeholder="${lang === "en" ? "e.g. ahmed123" : "مثال: ahmed123"}" autocomplete="username" dir="ltr" style="text-transform:lowercase">
        </div>
        ${
          isLogin
            ? ""
            : `<div class="wt-field">
          <label for="auth-email">${t("emailLabel")}</label>
          <input type="email" id="auth-email" name="kanz_login_email" placeholder="${t("emailPh")}" autocomplete="email" dir="ltr">
          <p class="wt-field-hint">${t("emailHint")}</p>
        </div>`
        }
        <div class="wt-field">
          <label for="auth-password">${lang === "en" ? "Password" : "الباسورد"}</label>
          <input type="password" id="auth-password" name="kanz_login_password" placeholder="${lang === "en" ? "at least 12 characters" : "١٢ حرف على الأقل"}" autocomplete="${isLogin ? "current-password" : "new-password"}" dir="ltr">
        </div>
        <p id="auth-err" class="wt-auth-err"></p>
        <label class="wt-auth-remember">
          <input type="checkbox" id="auth-remember-me" checked>
          <span>${t("rememberMe")}</span>
        </label>
        <button type="submit" class="wt-auth-btn" id="auth-submit-btn">
          ${isLogin ? (lang === "en" ? "Login" : "دخول") : lang === "en" ? "Create account" : "إنشاء حساب"}
        </button>
        ${
          isLogin
            ? `<div style="text-align:center;margin-top:12px">
          <button type="button" class="wt-link-btn" onclick="authMode='forgot';renderAuth()">${t("forgotPasswordLink")}</button>
        </div>`
            : ""
        }
      </form>`;
}

// ── Forgot password (step 1: request a code) ────────────
function renderForgotForm() {
  return `
      <form id="forgot-form" onsubmit="submitForgotUsername(event)">
        <p style="color:var(--wt-text-dim);font-size:13px;margin:0 0 14px">${t("forgotPasswordHint")}</p>
        <div class="wt-field">
          <label for="forgot-username">${lang === "en" ? "Username" : "اسم المستخدم"}</label>
          <input type="text" id="forgot-username" placeholder="${lang === "en" ? "e.g. ahmed123" : "مثال: ahmed123"}" autocomplete="username" dir="ltr" style="text-transform:lowercase">
        </div>
        <p id="forgot-err" class="wt-auth-err"></p>
        <button type="submit" class="wt-auth-btn" id="forgot-submit-btn">${t("sendCodeBtn")}</button>
        <div style="text-align:center;margin-top:12px">
          <button type="button" class="wt-link-btn" onclick="authMode='login';renderAuth()">${t("backToLogin")}</button>
        </div>
      </form>`;
}

// ── Forgot password (step 2: submit the code + new password) ──
function renderResetOtpForm() {
  return `
      <form id="reset-otp-form" onsubmit="submitResetOtp(event)">
        <p style="color:var(--wt-text-dim);font-size:13px;margin:0 0 14px">${t("codeSentTo")(forgotFlowEmail || "")}</p>
        <div class="wt-field">
          <label for="reset-otp">${t("otpLabel")}</label>
          <input type="text" id="reset-otp" placeholder="${t("otpPh")}" inputmode="numeric" maxlength="6" dir="ltr" style="letter-spacing:4px;text-align:center;font-family:'JetBrains Mono',monospace">
        </div>
        <div class="wt-field">
          <label for="reset-new-password">${t("newPasswordLabel")}</label>
          <input type="password" id="reset-new-password" placeholder="${lang === "en" ? "at least 12 characters" : "١٢ حرف على الأقل"}" autocomplete="new-password" dir="ltr">
        </div>
        <p id="reset-otp-err" class="wt-auth-err"></p>
        <button type="submit" class="wt-auth-btn" id="reset-otp-submit-btn">${t("resetPasswordBtn")}</button>
        <div style="text-align:center;margin-top:12px;display:flex;justify-content:center;gap:16px">
          <button type="button" class="wt-link-btn" onclick="submitForgotUsername()">${t("resendCodeBtn")}</button>
          <button type="button" class="wt-link-btn" onclick="authMode='login';renderAuth()">${t("backToLogin")}</button>
        </div>
      </form>`;
}

function submitForgotUsername(ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  const usernameInput = document.getElementById("forgot-username");
  // Re-submitting via "resend code" (no event) reuses the username already
  // confirmed in step 1 rather than requiring the user to retype it.
  const username = usernameInput ? (usernameInput.value || "").trim().toLowerCase() : forgotFlowUsername;
  const btn = document.getElementById("forgot-submit-btn") || document.querySelector(".wt-link-btn");
  const errEl = document.getElementById("forgot-err") || document.getElementById("reset-otp-err");

  if (!username) {
    if (errEl) {
      errEl.textContent = t("enterUsername");
      errEl.style.display = "block";
    }
    return;
  }

  if (btn) btn.disabled = true;

  callApi("forgotPassword", username)
    .then(function (j) {
      if (btn) btn.disabled = false;
      if (j.ok) {
        forgotFlowUsername = username;
        forgotFlowEmail = j.maskedEmail || "";
        authMode = "resetOtp";
        renderAuth();
      } else if (errEl) {
        errEl.textContent = j.error ? t(j.error) : t("genericError");
        errEl.style.display = "block";
      }
    })
    .catch(function () {
      if (btn) btn.disabled = false;
      if (errEl) {
        errEl.textContent = t("connectionError");
        errEl.style.display = "block";
      }
    });
}

function submitResetOtp(ev) {
  if (ev) ev.preventDefault();
  const otp = (document.getElementById("reset-otp").value || "").trim();
  const newPassword = document.getElementById("reset-new-password").value || "";
  const btn = document.getElementById("reset-otp-submit-btn");
  const errEl = document.getElementById("reset-otp-err");

  errEl.style.display = "none";
  btn.disabled = true;

  callApi("resetPassword", forgotFlowUsername, otp, newPassword)
    .then(function (j) {
      btn.disabled = false;
      if (j.ok) {
        forgotFlowUsername = null;
        forgotFlowEmail = null;
        completeLogin(j.username, j.token, j.expiresAt);
      } else {
        errEl.textContent = j.error ? t(j.error) : t("genericError");
        errEl.style.display = "block";
      }
    })
    .catch(function () {
      btn.disabled = false;
      errEl.textContent = t("connectionError");
      errEl.style.display = "block";
    });
}

function submitAuth(ev) {
  if (ev) ev.preventDefault();
  const username = (document.getElementById("auth-username").value || "").trim().toLowerCase();
  const password = document.getElementById("auth-password").value || "";
  const emailEl = document.getElementById("auth-email");
  const email = emailEl ? (emailEl.value || "").trim().toLowerCase() : "";
  const btn = document.getElementById("auth-submit-btn");
  const errEl = document.getElementById("auth-err");

  errEl.style.display = "none";
  btn.disabled = true;
  btn.textContent = "…";

  const fn = authMode === "login" ? "logIn" : "signUp";
  callApi(fn, username, password, email)
    .then(function (j) {
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
    .catch(function () {
      btn.disabled = false;
      errEl.textContent = t("connectionError");
      errEl.style.display = "block";
      btn.textContent = "⚠";
    });
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
  apy = {};
  apyFrequency = {};
  qtyChangedAt = {};
  accruedValue = {};
  order = [];
  customAssets = [];
  excludedBaseIds = new Set();
  baseOverrides = {};
  historyData = [];
  contributionsData = [];
  theme = "dark";
  lang = "en";
  savingsGoal = 0;
  ASSETS.forEach((a) => (qty[a.id] = 0));
  render();
  fetchRates();
  loadData();
  loadHistory();
  loadContributions();
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
  apy = {};
  apyFrequency = {};
  qtyChangedAt = {};
  accruedValue = {};
  order = [];
  customAssets = [];
  excludedBaseIds = new Set();
  baseOverrides = {};
  historyData = [];
  contributionsData = [];
  historyChart = null;
  outerChart = null;
  innerChart = null;
  savingsGoal = 0;
  goalModalOpen = false;
  contribModalOpen = false;
  emailModalOpen = false;
  forgotFlowUsername = null;
  forgotFlowEmail = null;
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

  callApi("loginWithToken", saved.username, saved.token)
    .then(function (j) {
      if (j && j.ok) {
        currentUser = j.username;
        // The server issues a fresh 1-day token on every verify call so the
        // session auto-renews on each page load. Save it immediately so the
        // next page load picks up the new expiry.
        const freshToken = j.token || saved.token;
        const freshExpiry = j.expiresAt || saved.expiresAt;
        sessionToken = freshToken;
        try {
          sessionStorage.setItem("kanz_user", currentUser);
          localStorage.setItem(
            "kanz_remember",
            JSON.stringify({ username: currentUser, token: freshToken, expiresAt: freshExpiry })
          );
        } catch (e) {}
        qty = {};
        apy = {};
        apyFrequency = {};
        qtyChangedAt = {};
        accruedValue = {};
        order = [];
        customAssets = [];
        excludedBaseIds = new Set();
        baseOverrides = {};
        historyData = [];
        contributionsData = [];
        ASSETS.forEach((a) => (qty[a.id] = 0));
        render();
        fetchRates();
        loadData();
        loadHistory();
        loadContributions();
      } else {
        try {
          localStorage.removeItem("kanz_remember");
        } catch (e) {}
        render();
      }
    })
    .catch(function () {
      try {
        localStorage.removeItem("kanz_remember");
      } catch (e) {}
      render();
    });
}

// ── Recovery email (settings, for already-logged-in users) ─────
// Lets a user add or change the email forgot-password codes get sent to —
// same "PUT /auth/email" endpoint whether they're setting one for the first
// time or replacing an existing one.
function openEmailModal() {
  emailModalOpen = true;
  render();
  setTimeout(() => {
    const f = document.getElementById("email-modal-input");
    if (f) f.focus();
  }, 50);
}

function closeEmailModal() {
  emailModalOpen = false;
  render();
}

function submitEmailUpdate(ev) {
  ev.preventDefault();
  const email = (document.getElementById("email-modal-input").value || "").trim().toLowerCase();
  const btn = document.getElementById("email-modal-submit-btn");
  const errEl = document.getElementById("email-modal-err");

  errEl.style.display = "none";
  btn.disabled = true;

  callApi("updateEmail", email, sessionToken)
    .then(function (j) {
      btn.disabled = false;
      if (j.ok) {
        emailModalOpen = false;
        render();
      } else {
        errEl.textContent = j.error ? t(j.error) : t("genericError");
        errEl.style.display = "block";
      }
    })
    .catch(function () {
      btn.disabled = false;
      errEl.textContent = t("connectionError");
      errEl.style.display = "block";
    });
}

function renderEmailModal() {
  return `
  <div class="wt-modal-overlay" onclick="if(event.target===this)closeEmailModal()">
    <div class="wt-modal">
      <h3>${t("emailModalTitle")}</h3>
      <p style="color:var(--wt-text-dim);font-size:13px;margin:0 0 14px">${t("emailModalHint")}</p>
      <form onsubmit="submitEmailUpdate(event)">
        <div class="wt-field">
          <label for="email-modal-input">${t("emailLabel")}</label>
          <input type="email" id="email-modal-input" placeholder="${t("emailPh")}" autocomplete="email" dir="ltr">
        </div>
        <p id="email-modal-err" class="wt-auth-err"></p>
        <div class="wt-modal-actions">
          <button type="button" class="wt-btn-ghost" onclick="closeEmailModal()">${t("cancel")}</button>
          <button type="submit" class="wt-btn" id="email-modal-submit-btn">${t("saveChanges")}</button>
        </div>
      </form>
    </div>
  </div>`;
}
// Response shape: { ok, data, customAssets, excludedBaseIds, baseOverrides }
function loadData() {
  if (!currentUser) return;
  isLoadingData = true; // block scheduleSave while loading
  syncStatus = "loading";
  renderSyncBadge();
  callApi("loadDataForClient", currentUser, sessionToken)
    .then(function (j) {
      if (j && j.ok) {
        if (Array.isArray(j.customAssets)) customAssets = j.customAssets;
        if (Array.isArray(j.excludedBaseIds)) excludedBaseIds = new Set(j.excludedBaseIds);
        if (j.baseOverrides && typeof j.baseOverrides === "object") baseOverrides = j.baseOverrides;
        if (j.theme === "light" || j.theme === "dark") theme = j.theme;
        if (j.lang === "ar" || j.lang === "en") lang = j.lang;
        savingsGoal = typeof j.savingsGoal === "number" ? j.savingsGoal : 0;
        apy = j.apy && typeof j.apy === "object" ? j.apy : {};
        apyFrequency = j.apyFrequency && typeof j.apyFrequency === "object" ? j.apyFrequency : {};
        qtyChangedAt = j.qtyChangedAt && typeof j.qtyChangedAt === "object" ? j.qtyChangedAt : {};
        accruedValue = j.accruedValue && typeof j.accruedValue === "object" ? j.accruedValue : {};

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
    .catch(function (err) {
      isLoadingData = false;
      syncStatus = "error";
      console.error("loadData:", err);
      render();
      renderBreakdown();
    });
}
