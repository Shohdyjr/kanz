const OUNCE_TO_GRAM = 31.1034768;

/** Currency each built-in ("base") asset is denominated in. */
const BASE_ASSET_CURRENCY = {
  thunder_save: "EGP", thunder_invest: "EGP", tilda_invest: "EGP",
  ahli: "EGP", mashreq: "EGP", car: "EGP",
  usd: "USD", eur: "EUR", sar: "SAR", gold: "GOLD",
};

const HARD_CURRENCIES = ["USD", "EUR", "SAR"];

/** Default portfolio shape for a newly created user. */
function defaultUserData() {
  const customAssets = [
    { id: "default_bank",  name_ar: "بنك",        name_en: "Bank",          icon: "🏦", currency: "EGP"  },
    { id: "default_hard",  name_ar: "عملة صعبة",  name_en: "Hard Currency", icon: "💵", currency: "USD"  },
    { id: "default_gold",  name_ar: "ذهب",        name_en: "Gold",          icon: "🪙", currency: "GOLD" },
    { id: "default_asset", name_ar: "أصول",       name_en: "Assets",        icon: "🚗", currency: "EGP"  },
  ];
  return {
    qty: { default_bank: 0, default_hard: 0, default_gold: 0, default_asset: 0 },
    customAssets,
    excludedBaseIds: Object.keys(BASE_ASSET_CURRENCY),
    baseOverrides: {},
    theme: "dark",
    lang: "en",
    order: customAssets.map((a) => a.id),
  };
}

async function fetchHourlyRates() {
  try {
    const res = await fetch("https://api.exchangerate.fun/latest?base=USD");
    const json = await res.json();
    if (!json.rates?.EGP) return null;
    return { egpPerUsd: json.rates.EGP, eurPerUsd: json.rates.EUR, sarPerUsd: json.rates.SAR };
  } catch {
    return null;
  }
}

async function fetchDailyRatesFallback() {
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  const fx = await res.json();
  return { egpPerUsd: fx.rates.EGP, eurPerUsd: fx.rates.EUR, sarPerUsd: fx.rates.SAR };
}

/** Fetches current FX rates plus gold price (USD/gram), server-side. */
async function fetchRatesServerSide() {
  const fx = (await fetchHourlyRates()) || (await fetchDailyRatesFallback());
  const goldRes = await fetch("https://api.gold-api.com/price/XAU");
  const gold = await goldRes.json();
  fx.goldUsdPerGram = (gold.price ?? gold.rate ?? gold.value) / OUNCE_TO_GRAM;
  return fx;
}

function priceForServerSide(currency, rates) {
  switch (currency) {
    case "USD":  return 1;
    case "EGP":  return 1 / rates.egpPerUsd;
    case "EUR":  return 1 / rates.eurPerUsd;
    case "SAR":  return 1 / rates.sarPerUsd;
    case "GOLD": return rates.goldUsdPerGram;
    default:     return 0;
  }
}

/** Computes a portfolio snapshot (grouped USD totals) for a given day. */
function computeSnapshot(userData, rates, dateStr) {
  const excludedIds  = userData.excludedBaseIds || [];
  const overrides    = userData.baseOverrides || {};
  const customAssets = (userData.customAssets || []).map((c) => ({ id: c.id, currency: c.currency, isAsset: !!c.isAsset }));
  const qty          = userData.qty || {};

  const baseAssets = Object.keys(BASE_ASSET_CURRENCY)
    .filter((id) => !excludedIds.includes(id))
    .map((id) => {
      const override = overrides[id];
      return {
        id,
        currency: BASE_ASSET_CURRENCY[id],
        isAsset: typeof override?.isAsset === "boolean" ? override.isAsset : id === "car",
      };
    });

  const totals = { egpUsd: 0, hardUsd: 0, goldUsd: 0, assetsUsd: 0 };

  for (const asset of [...baseAssets, ...customAssets]) {
    const value = (parseFloat(qty[asset.id]) || 0) * priceForServerSide(asset.currency, rates);
    if (asset.isAsset) totals.assetsUsd += value;
    else if (asset.currency === "EGP") totals.egpUsd += value;
    else if (asset.currency === "GOLD") totals.goldUsd += value;
    else if (HARD_CURRENCIES.includes(asset.currency)) totals.hardUsd += value;
  }

  return {
    date: dateStr,
    totalUsd: totals.egpUsd + totals.hardUsd + totals.goldUsd + totals.assetsUsd,
    ...totals,
  };
}

module.exports = {
  OUNCE_TO_GRAM,
  BASE_ASSET_CURRENCY,
  defaultUserData,
  fetchRatesServerSide,
  priceForServerSide,
  computeSnapshot,
};
