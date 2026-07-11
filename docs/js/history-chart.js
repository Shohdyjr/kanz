function setHistoryChartPeriod(period) {
  historyChartPeriod = period;
  renderHistory();
}

// Start date of the chart's visible window, using the same growth-calculation
// logic so the chart and the numbers stay consistent
function getChartPeriodStartDate(period) {
  if (period === "7d") {
    const c = getGrowthCandidate(7);
    return c ? c.date : null;
  }
  if (period === "30d") {
    const c = getGrowthCandidate(30);
    return c ? c.date : null;
  }
  if (period === "mtd") {
    const now = new Date();
    const monthStart = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-01";
    const c = historyData.find((h) => h.date >= monthStart);
    return c ? c.date : null;
  }
  if (period === "ytd") {
    const yearStart = new Date().getFullYear() + "-01-01";
    const c = historyData.find((h) => h.date >= yearStart);
    return c ? c.date : null;
  }
  return null; // "all"
}

function renderHistory() {
  const root = document.getElementById("wt-history-root");
  if (!root) return;

  const addBtn = `<button class="wt-btn-add" onclick="openHistoryModal()" title="${t("addHistoryBtn")}">+</button>`;
  const manageBtn = `<button class="wt-btn wt-btn-ghost" style="font-size:12px;padding:6px 10px" onclick="openHistoryManager()">${t("manageHistoryBtn")}</button>`;

  if (!historyData || historyData.length === 0) {
    root.innerHTML = `
    <div class="wt-breakdown">
      <div class="wt-table-head" style="margin-bottom:8px">
        <p class="wt-bk-title" style="margin:0">${t("historyTitle")}</p>
        <div class="wt-actions">${manageBtn}${addBtn}</div>
      </div>
      <p style="color:var(--wt-text-dim);font-size:13px;margin:0">${t("historyEmpty")}</p>
    </div>
    ${historyModalOpen ? renderHistoryModal() : ""}
    ${historyManagerOpen ? renderHistoryManager() : ""}`;
    return;
  }

  root.innerHTML = `
  <div class="wt-breakdown">
    <div class="wt-table-head" style="margin-bottom:8px">
      <p class="wt-bk-title" style="margin:0">${t("historyTitle")}</p>
      <div class="wt-actions">${manageBtn}${addBtn}</div>
    </div>
    <div class="wt-chart-periods">
      <button class="wt-chart-period-btn ${historyChartPeriod === "7d" ? "active" : ""}"  onclick="setHistoryChartPeriod('7d')">${t("chartPeriod7d")}</button>
      <button class="wt-chart-period-btn ${historyChartPeriod === "30d" ? "active" : ""}" onclick="setHistoryChartPeriod('30d')">${t("chartPeriod30d")}</button>
      <button class="wt-chart-period-btn ${historyChartPeriod === "mtd" ? "active" : ""}" onclick="setHistoryChartPeriod('mtd')">${t("chartPeriodMtd")}</button>
      <button class="wt-chart-period-btn ${historyChartPeriod === "ytd" ? "active" : ""}" onclick="setHistoryChartPeriod('ytd')">${t("chartPeriodYtd")}</button>
      <button class="wt-chart-period-btn ${historyChartPeriod === "all" ? "active" : ""}" onclick="setHistoryChartPeriod('all')">${t("chartPeriodAll")}</button>
      <button class="wt-chart-period-btn ${showBenchmark ? "active" : ""}" onclick="toggleBenchmark()" style="margin-inline-start:auto">${t("benchmarkToggle")}</button>
    </div>
    ${benchmarkError ? `<div style="color:var(--wt-red,#e5484d);font-size:12px;margin-bottom:6px">${benchmarkError}</div>` : ""}
    <div style="position:relative;height:220px">
      <canvas id="history-chart"></canvas>
    </div>

    <div id="wt-change-analysis-root" style="margin-top:18px"></div>
  </div>
  ${historyModalOpen ? renderHistoryModal() : ""}
  ${historyManagerOpen ? renderHistoryManager() : ""}`;

  const periodStart = getChartPeriodStartDate(historyChartPeriod);
  let filteredHistory = periodStart ? historyData.filter((h) => h.date >= periodStart) : historyData;
  if (filteredHistory.length === 0) filteredHistory = historyData; // fallback if filtering returned empty for any reason

  const labels = filteredHistory.map((h) => h.date);
  const totals = filteredHistory.map((h) => h.totalUsd);
  const egpSeries = filteredHistory.map((h) => h.egpUsd);
  const hardSeries = filteredHistory.map((h) => h.hardUsd);
  const goldSeries = filteredHistory.map((h) => h.goldUsd);
  const assetsSeries = filteredHistory.map((h) => h.assetsUsd);

  // ── Change breakdown: how much each category moved in the selected period ──
  renderChangeAnalysis(filteredHistory);

  // ── Main chart: total only, so the real movement is clearly visible ──
  // (plotting all four category lines on the same scale would stretch the Y axis
  // to fit the smallest category, visually flattening the actual total movement)
  if (historyChart) {
    historyChart.destroy();
    historyChart = null;
  }
  const ctx = document.getElementById("history-chart");
  const gold = getComputedStyle(document.getElementById("bodyRoot")).getPropertyValue("--wt-gold-light").trim();
  const lineColor = getComputedStyle(document.getElementById("bodyRoot")).getPropertyValue("--wt-text-dim").trim();

  historyChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: t("historyTotalLabel"),
          data: totals,
          borderColor: gold,
          backgroundColor: "transparent",
          borderWidth: 3,
          pointRadius: 3,
          pointBackgroundColor: gold,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => " " + ctx.dataset.label + ": " + fmtUsd(ctx.parsed.y) } },
      },
      scales: {
        x: { ticks: { color: lineColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
        y: {
          ticks: { color: lineColor, callback: (v) => "$" + v.toLocaleString("en-US") },
          grid: { color: "rgba(255,255,255,.06)" },
        },
      },
    },
  });

  if (showBenchmark) loadAndOverlayBenchmark(labels, totals);
}

// ── S&P 500 benchmark comparison (optional) ──────────────────────
function toggleBenchmark() {
  showBenchmark = !showBenchmark;
  benchmarkError = null;
  renderHistory();
}

function loadAndOverlayBenchmark(labels, totals) {
  if (!labels || labels.length < 2) {
    benchmarkError = t("benchmarkNeedsData");
    renderHistory();
    return;
  }
  const fromDate = labels[0];
  const toDate = labels[labels.length - 1];

  callApi("fetchBenchmarkSeries", fromDate, toDate)
    .then(function (j) {
      if (!j || !j.ok || !historyChart) {
        benchmarkError = j && j.error ? t(j.error) : t("benchmarkUnavailable");
        renderHistory();
        return;
      }

      const spxByDate = {};
      j.series.forEach((p) => {
        spxByDate[p.date] = p.close;
      });
      const sortedSpxDates = j.series.map((p) => p.date).sort();

      // Latest known price on or before the requested date (carries forward over market holidays)
      function closestSpxClose(targetDate) {
        let best = null;
        for (const d of sortedSpxDates) {
          if (d <= targetDate) best = d;
          else break;
        }
        return best ? spxByDate[best] : null;
      }

      const firstClose = closestSpxClose(labels[0]);
      if (!firstClose) {
        benchmarkError = t("benchmarkUnavailable");
        renderHistory();
        return;
      }
      const scale = totals[0] / firstClose; // normalize so both lines start at the same point, comparing % growth

      const benchmarkData = labels.map((dt) => {
        const c = closestSpxClose(dt);
        return c ? c * scale : null;
      });

      historyChart.data.datasets = historyChart.data.datasets.filter((ds) => ds.label !== t("benchmarkLabel"));
      historyChart.data.datasets.push({
        label: t("benchmarkLabel"),
        data: benchmarkData,
        borderColor: "#9c7a4a",
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        tension: 0.15,
      });
      historyChart.options.plugins.legend.display = true;
      historyChart.options.plugins.legend.position = "bottom";
      historyChart.options.plugins.legend.labels = {
        color: getComputedStyle(document.getElementById("bodyRoot")).getPropertyValue("--wt-text-dim").trim(),
        boxWidth: 10,
        boxHeight: 10,
        font: { size: 11 },
        usePointStyle: true,
      };
      historyChart.update();
    })
    .catch(function (err) {
      console.warn("Benchmark fetch failed:", err);
      benchmarkError = t("benchmarkUnavailable");
      renderHistory();
    });
}

// ── Change breakdown: how much each category moved, in $ and %, over the shown period ──
// Compares the first and last snapshot in the filtered period, ranked from
// biggest to smallest mover, to make clear "what moved the number"
function renderChangeAnalysis(filteredHistory) {
  const root = document.getElementById("wt-change-analysis-root");
  if (!root) return;

  if (!filteredHistory || filteredHistory.length < 2) {
    root.innerHTML = `<p style="color:var(--wt-text-dim);font-size:12px;margin:0">${t("changeAnalysisEmpty")}</p>`;
    return;
  }

  const start = filteredHistory[0];
  const end = filteredHistory[filteredHistory.length - 1];

  const rows = [
    { key: "egpUsd", name: t("bkEgp"), color: BK_COLORS.EGP },
    { key: "hardUsd", name: t("bkHard"), color: "#4a8fdb" },
    { key: "goldUsd", name: t("bkGold"), color: BK_COLORS.GOLD },
    { key: "assetsUsd", name: t("bkAssets"), color: BK_COLORS.ASSETS },
  ].map((r) => ({ ...r, delta: (end[r.key] || 0) - (start[r.key] || 0) }));

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.delta)), 0.01);
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  root.innerHTML = `
  <p class="wt-bk-leg-title" style="margin-bottom:10px">${t("changeAnalysisTitle")}</p>
  ${rows
    .map((r) => {
      const up = r.delta >= 0;
      const sign = up ? "+" : "";
      const color = up ? "var(--wt-green)" : "var(--wt-red)";
      const widthPct = (Math.abs(r.delta) / maxAbs) * 100;
      return `<div class="wt-change-row">
      <div class="wt-change-name">${r.name}</div>
      <div class="wt-change-track"><div class="wt-change-fill" style="width:${widthPct.toFixed(1)}%;background:${r.color}"></div></div>
      <div class="wt-change-val" style="color:${color}">${sign}${fmtUsd(r.delta)}</div>
    </div>`;
    })
    .join("")}`;
}
