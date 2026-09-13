export function shortAddress(addr) {
  if (!addr) return "";
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 9)}…${addr.slice(-4)}`;
}

function localeOf(locale) {
  return locale || (typeof navigator !== "undefined" ? navigator.language : "en");
}

export function formatNumber(value, locale, options = {}) {
  if (value == null || value === "") return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString(localeOf(locale), {
    maximumFractionDigits: 2,
    ...options,
  });
}

export function recordUsdPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1e8) / 1e8;
}

export function formatFiat(value, locale, currency = "USD") {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString(localeOf(locale), {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatUsd(value, locale) {
  return formatUsdAmount(value, locale);
}

export function formatUsdAmount(value, locale) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const abs = Math.abs(num);
  let minimumFractionDigits = 2;
  let maximumFractionDigits = 2;
  if (abs > 0 && abs < 0.01) {
    maximumFractionDigits = 6;
  } else if (abs > 0 && abs < 1) {
    maximumFractionDigits = 4;
  }
  return num.toLocaleString(localeOf(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

export function formatUsdPrice(value, locale) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString(localeOf(locale), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 8,
    maximumFractionDigits: 8,
  });
}

export function formatQuotePerBase(value, locale, quote = "XRP") {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "—";
  const formatted = num.toLocaleString(localeOf(locale), {
    minimumFractionDigits: 8,
    maximumFractionDigits: 8,
  });
  return quote ? `${formatted} ${quote}` : formatted;
}

export function formatXrpPrice(value, locale) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "—";
  return `${num.toLocaleString(localeOf(locale), {
    minimumFractionDigits: 8,
    maximumFractionDigits: 8,
  })} XRP`;
}

export function formatToken(value, locale, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString(localeOf(locale), {
    maximumFractionDigits: digits,
  });
}

export function formatPercent(value, locale) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${num.toLocaleString(localeOf(locale), {
    maximumFractionDigits: 2,
  })}%`;
}

export function formatGbp(value, locale) {
  return formatFiat(value, locale, "GBP");
}

export function formatEur(value, locale) {
  return formatFiat(value, locale, "EUR");
}

export function formatJpy(value, locale) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString(localeOf(locale), {
    style: "currency",
    currency: "JPY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatSharePercent(value, locale) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const digits = Math.abs(num) < 1 ? 3 : 2;
  return `${num.toLocaleString(localeOf(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function formatSupplySharePercent(value, locale) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${Math.min(100, num).toLocaleString(localeOf(locale), {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  })}%`;
}

export function formatWhen(value, locale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(localeOf(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(value, locale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(localeOf(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function shareOf(part, total) {
  const value = Number(part);
  const sum = Number(total);
  if (!Number.isFinite(value) || !Number.isFinite(sum) || sum <= 0) return null;
  return (value / sum) * 100;
}
