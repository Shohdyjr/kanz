// ── Saving data to the backend ────────────
function sheetsSave() {
  if (!currentUser) return;
  syncStatus = "saving";
  renderSyncBadge();
  const data = {};
  ASSETS.forEach((a) => {
    data[a.id] = qty[a.id] || 0;
  });
  rpc.run
    .withSuccessHandler(function (j) {
      if (j && j.ok) {
        syncStatus = "synced";
      } else {
        syncStatus = "error";
        console.error("sheetsSave: server rejected the save", j && j.error);
      }
      renderSyncBadge();
    })
    .withFailureHandler(function (err) {
      syncStatus = "error";
      console.error("sheetsSave:", err);
      renderSyncBadge();
    })
    .saveDataFromClient(
      currentUser,
      data,
      customAssets,
      [...excludedBaseIds],
      baseOverrides,
      theme,
      lang,
      order,
      savingsGoal,
      sessionToken,
      apy
    );
}

let isLoadingData = false; // guard to prevent scheduleSave firing during a load

// ── Export a full backup (JSON) — all assets + entire history ──────────
// A plain file you can open in any text editor or import manually if
// needed, with zero external dependency
function exportBackup() {
  const backup = {
    exportedAt: new Date().toISOString(),
    username: currentUser,
    assets: ASSETS.map((a) => ({
      id: a.id,
      name_ar: a.name_ar,
      name_en: a.name_en,
      icon: a.icon,
      currency: a.currency,
      isAsset: !!a.isAsset,
      quantity: qty[a.id] || 0,
    })),
    savingsGoal: savingsGoal || 0,
    history: historyData,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "kanz-backup-" + (currentUser || "user") + "-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function scheduleSave() {
  if (isLoadingData) return; // don't save while data is loading
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sheetsSave(), 1200);
}

function renderSyncBadge() {
  const el = document.getElementById("wt-sync-badge");
  if (!el) return;
  const map = {
    idle: { txt: t("syncIdle"), cls: "" },
    loading: { txt: t("syncLoading"), cls: "sync-loading" },
    saving: { txt: t("syncSaving"), cls: "sync-saving" },
    synced: { txt: t("syncOk"), cls: "sync-ok" },
    error: { txt: t("syncErr"), cls: "sync-err" },
  };
  const s = map[syncStatus] || map.idle;
  el.innerHTML = s.txt;
  el.className = "wt-sync-badge " + s.cls;
}
