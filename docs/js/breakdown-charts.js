// ── Breakdown Charts ────────────────────────────────────
const BK_COLORS = {
  EGP: "#5fae6e",
  USD: "#4a8fdb",
  EUR: "#7bbcdb",
  SAR: "#c084d6",
  GOLD: "#d4af37",
  ASSETS: "#d9695f",
};

function pct(val, total) {
  return total > 0 ? (val / total) * 100 : 0;
}
function fmtPct(n) {
  return n.toFixed(1) + "%";
}

function renderBreakdown() {
  const root = document.getElementById("wt-bk-root");
  if (!root || !rates) return;

  let egpUsd = 0,
    hardUsd = { USD: 0, EUR: 0, SAR: 0 },
    goldUsd = 0,
    assetsUsd = 0;
  ASSETS.forEach((a) => {
    const v = (qty[a.id] || 0) * priceFor(a);
    if (a.isAsset) assetsUsd += v;
    else if (a.currency === "EGP") egpUsd += v;
    else if (a.currency === "GOLD") goldUsd += v;
    else if (hardUsd[a.currency] !== undefined) hardUsd[a.currency] += v;
  });

  const hardTotal = hardUsd.USD + hardUsd.EUR + hardUsd.SAR;
  const totalUsd = egpUsd + hardTotal + goldUsd + assetsUsd;
  const egpP = pct(egpUsd, totalUsd);
  const hardP = pct(hardTotal, totalUsd);
  const goldP = pct(goldUsd, totalUsd);
  const assetsP = pct(assetsUsd, totalUsd);
  const usdP = pct(hardUsd.USD, hardTotal);
  const eurP = pct(hardUsd.EUR, hardTotal);
  const sarP = pct(hardUsd.SAR, hardTotal);
  const chartEmpty =
    getComputedStyle(document.getElementById("bodyRoot")).getPropertyValue("--wt-chart-empty").trim() || "#2a2a2a";

  root.innerHTML = `
  <div class="wt-breakdown">
    <p class="wt-bk-title">${t("bkTitle")}</p>
    <div class="wt-bk-body">
      <div class="wt-bk-donuts">
        <div class="wt-bk-donut-col">
          <span class="wt-bk-donut-lbl">${t("bkOverall")}</span>
          <div class="wt-bk-donut-wrap" style="width:160px;height:160px">
            <canvas id="bk-outer" width="160" height="160"></canvas>
            <div class="wt-bk-center">
              <span class="wt-bk-center-val" id="bk-outer-pct">—</span>
              <span class="wt-bk-center-sub" id="bk-outer-sub">—</span>
            </div>
          </div>
        </div>
        <div class="wt-bk-donut-col">
          <span class="wt-bk-donut-lbl">${t("bkInsideHard")}</span>
          <div class="wt-bk-donut-wrap" style="width:130px;height:130px">
            <canvas id="bk-inner" width="130" height="130"></canvas>
            <div class="wt-bk-center">
              <span class="wt-bk-center-val" id="bk-inner-pct">—</span>
              <span class="wt-bk-center-sub" id="bk-inner-sub">—</span>
            </div>
          </div>
        </div>
      </div>
      <div class="wt-bk-right">
        <div class="wt-bk-leg">
          <p class="wt-bk-leg-title">${t("bkMainCats")}</p>
          <div class="wt-bk-leg-row"><div class="wt-bk-leg-dot" style="background:${BK_COLORS.EGP}"></div><span class="wt-bk-leg-name">${t("bkEgp")}</span><span class="wt-bk-leg-val">${fmtPct(egpP)}</span></div>
          <div class="wt-bk-leg-row"><div class="wt-bk-leg-dot" style="background:#4a8fdb"></div><span class="wt-bk-leg-name">${t("bkHard")}</span><span class="wt-bk-leg-val">${fmtPct(hardP)}</span></div>
          <div class="wt-bk-leg-row"><div class="wt-bk-leg-dot" style="background:${BK_COLORS.GOLD}"></div><span class="wt-bk-leg-name">${t("bkGold")}</span><span class="wt-bk-leg-val">${fmtPct(goldP)}</span></div>
          <div class="wt-bk-leg-row"><div class="wt-bk-leg-dot" style="background:${BK_COLORS.ASSETS}"></div><span class="wt-bk-leg-name">${t("bkAssets")}</span><span class="wt-bk-leg-val">${fmtPct(assetsP)}</span></div>
        </div>
        ${
          hardTotal > 0
            ? `<div class="wt-bk-leg">
          <p class="wt-bk-leg-title">${t("bkHardDetail")}</p>
          <div class="wt-bk-bars">
            ${[
              { n: t("bkUsd"), v: usdP, c: BK_COLORS.USD },
              { n: t("bkEur"), v: eurP, c: BK_COLORS.EUR },
              { n: t("bkSar"), v: sarP, c: BK_COLORS.SAR },
            ]
              .map(
                (b) => `<div class="wt-bk-bar-row">
                <div class="wt-bk-bar-name">${b.n}</div>
                <div class="wt-bk-bar-track"><div class="wt-bk-bar-fill" style="width:${b.v.toFixed(1)}%;background:${b.c}"></div></div>
                <div class="wt-bk-bar-pct">${fmtPct(b.v)}</div>
              </div>`
              )
              .join("")}
          </div>
        </div>`
            : ""
        }
      </div>
    </div>
  </div>`;

  // Outer donut
  if (outerChart) {
    outerChart.destroy();
    outerChart = null;
  }
  const empty = totalUsd === 0;
  outerChart = new Chart(document.getElementById("bk-outer"), {
    type: "doughnut",
    data: {
      labels: [t("bkEgp"), t("bkHard"), t("bkGold"), t("bkAssets")],
      datasets: [
        {
          data: empty ? [1, 0, 0, 0] : [egpP, hardP, goldP, assetsP],
          backgroundColor: empty
            ? [chartEmpty, chartEmpty, chartEmpty, chartEmpty]
            : [BK_COLORS.EGP, "#4a8fdb", BK_COLORS.GOLD, BK_COLORS.ASSETS],
          borderWidth: 0,
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: false,
      cutout: "66%",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => " " + fmtPct(ctx.parsed) } } },
    },
  });
  const outerBig = [
    { n: t("bkEgp"), v: egpP },
    { n: t("bkHard"), v: hardP },
    { n: t("bkGold"), v: goldP },
    { n: t("bkAssets"), v: assetsP },
  ].sort((a, b) => b.v - a.v)[0];
  document.getElementById("bk-outer-pct").textContent = fmtPct(outerBig.v);
  document.getElementById("bk-outer-sub").textContent = outerBig.n;

  // Inner donut
  if (innerChart) {
    innerChart.destroy();
    innerChart = null;
  }
  const iEmpty = hardTotal === 0;
  innerChart = new Chart(document.getElementById("bk-inner"), {
    type: "doughnut",
    data: {
      labels: [t("bkUsd"), t("bkEur"), t("bkSar")],
      datasets: [
        {
          data: iEmpty ? [1, 0, 0] : [usdP, eurP, sarP],
          backgroundColor: iEmpty
            ? [chartEmpty, chartEmpty, chartEmpty]
            : [BK_COLORS.USD, BK_COLORS.EUR, BK_COLORS.SAR],
          borderWidth: 0,
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: false,
      cutout: "62%",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => " " + fmtPct(ctx.parsed) } } },
    },
  });
  const innerBig = [
    { n: "USD", v: usdP },
    { n: "EUR", v: eurP },
    { n: "SAR", v: sarP },
  ].sort((a, b) => b.v - a.v)[0];
  document.getElementById("bk-inner-pct").textContent = iEmpty ? "—%" : fmtPct(innerBig.v);
  document.getElementById("bk-inner-sub").textContent = iEmpty ? "—" : innerBig.n;
}
