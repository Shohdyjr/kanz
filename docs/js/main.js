// ── Initial run ─────────────────────────────────────────
applyTheme();
applyLang();
attemptAutoLogin(); // verifies the "remember me" token with the server, then shows login or the app accordingly

// Product Configuration is a full-screen view routed via location.hash (see
// return-config.js: openReturnPanel/closeReturnPanel/syncPanelFromHash).
// Both events fire on browser back/forward; only one of them is actually
// needed depending on the browser, so we listen for both and just re-render
// — render() re-syncs from the hash itself and is cheap/idempotent.
window.addEventListener("hashchange", render);
window.addEventListener("popstate", render);
