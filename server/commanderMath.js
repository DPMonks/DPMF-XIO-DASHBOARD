/**
 * Safe Commander math engine: evaluate expressions and desk helpers without eval().
 * Uses a restricted mathjs instance (no import/evaluate/parse/Function).
 */
import {create, all} from "mathjs";

const math = create(all, {
  number: "number",
  precision: 64,
});

const evaluateExpr = math.evaluate.bind(math);

math.import(
  {
    import: function () {
      throw new Error("Function import is disabled");
    },
    createUnit: function () {
      throw new Error("Function createUnit is disabled");
    },
    evaluate: function () {
      throw new Error("Function evaluate is disabled");
    },
    parse: function () {
      throw new Error("Function parse is disabled");
    },
    simplify: function () {
      throw new Error("Function simplify is disabled");
    },
    derivative: function () {
      throw new Error("Function derivative is disabled");
    },
    resolve: function () {
      throw new Error("Function resolve is disabled");
    },
  },
  { override: true }
);

const MAX_EXPR_LEN = 240;
const SAFE_EXPR_RE = /^[\d\s+\-*/%^().,eE]+$/;

function finiteOrNull(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatNum(n, digits = 6) {
  const v = finiteOrNull(n);
  if (v == null) return "n/a";
  if (Math.abs(v) >= 1e9 || (Math.abs(v) > 0 && Math.abs(v) < 1e-6)) {
    return v.toExponential(4);
  }
  const s = Number(v.toPrecision(Math.min(12, Math.max(4, digits))));
  return String(s);
}

/** Basis points from a fraction or percent input. */
export function toBps(value, { asPercent = false } = {}) {
  const v = finiteOrNull(value);
  if (v == null) return null;
  return asPercent ? v * 100 : v * 10_000;
}

export function fromBps(bps) {
  const v = finiteOrNull(bps);
  if (v == null) return null;
  return v / 10_000;
}

export function pctChange(from, to) {
  const a = finiteOrNull(from);
  const b = finiteOrNull(to);
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

/** Compound daily: start * (1 + dailyRate)^days. dailyRate as fraction (0.20 = +20%). */
export function compoundDaily(start, dailyRate, days) {
  const s = finiteOrNull(start);
  const r = finiteOrNull(dailyRate);
  const d = finiteOrNull(days);
  if (s == null || r == null || d == null || d < 0 || d > 3650) return null;
  return s * Math.pow(1 + r, d);
}

export function lpSharePct(lpOwned, lpTotal) {
  const o = finiteOrNull(lpOwned);
  const t = finiteOrNull(lpTotal);
  if (o == null || t == null || t <= 0) return null;
  return (o / t) * 100;
}

/** Rough fee split estimate: volume * feeRate * shareFraction. */
export function feeSplitEstimate(volume, feeRate, shareFraction) {
  const v = finiteOrNull(volume);
  const f = finiteOrNull(feeRate);
  const s = finiteOrNull(shareFraction);
  if (v == null || f == null || s == null) return null;
  return v * f * s;
}

export function notionalSize(units, mark) {
  const u = finiteOrNull(units);
  const m = finiteOrNull(mark);
  if (u == null || m == null) return null;
  return u * m;
}

export function drawdownPct(peak, trough) {
  const p = finiteOrNull(peak);
  const t = finiteOrNull(trough);
  if (p == null || t == null || p <= 0) return null;
  return ((p - t) / p) * 100;
}

/** Risk:reward from entry/stop/target. Positive R:R when target is on the reward side. */
export function riskReward(entry, stop, target) {
  const e = finiteOrNull(entry);
  const s = finiteOrNull(stop);
  const t = finiteOrNull(target);
  if (e == null || s == null || t == null) return null;
  const risk = Math.abs(e - s);
  const reward = Math.abs(t - e);
  if (risk <= 0) return null;
  return reward / risk;
}

/**
 * Evaluate a restricted arithmetic expression. Never eval().
 * @param {string} expr
 * @param {Record<string, number>} [scope]
 */
export function safeEvaluate(expr, scope = {}) {
  const raw = String(expr || "").trim();
  if (!raw || raw.length > MAX_EXPR_LEN) {
    return { ok: false, error: "expression_too_long_or_empty" };
  }
  // Allow scoped identifiers (wallet bindings) plus arithmetic.
  const cleaned = raw.replace(/,/g, "");
  const identOk = Object.keys(scope).every((k) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
  if (!identOk) return { ok: false, error: "bad_scope" };

  const allowedIdents = new Set(Object.keys(scope));
  // Strip identifiers for character check
  let probe = cleaned;
  for (const id of allowedIdents) {
    probe = probe.replace(new RegExp(`\\b${id}\\b`, "g"), "1");
  }
  if (!SAFE_EXPR_RE.test(probe)) {
    return { ok: false, error: "unsafe_characters" };
  }

  try {
    const value = evaluateExpr(cleaned, scope);
    const n = finiteOrNull(typeof value === "number" ? value : Number(value));
    if (n == null) return { ok: false, error: "non_numeric_result" };
    return { ok: true, value: n, expression: cleaned };
  } catch (err) {
    return { ok: false, error: String(err?.message || err).slice(0, 120) };
  }
}

function parseNumberToken(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/,/g, "").replace(/^\$/, "");
  const m = s.match(/^([\d.]+)\s*([kmb])$/i);
  if (m) {
    const base = Number(m[1]);
    if (!Number.isFinite(base)) return null;
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()];
    return base * mult;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build numeric scope from live wallet / board context when available.
 */
export function bindLiveScope(balances = null, markets = null, lpEarnings = null) {
  const scope = {};
  if (balances?.ok) {
    if (Number.isFinite(balances.xrp)) scope.xrp = Number(balances.xrp);
    if (balances.xio && Number.isFinite(balances.xio.balance)) scope.xio = Number(balances.xio.balance);
    for (const row of balances.lines || []) {
      const code = String(row.currency || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (code && Number.isFinite(row.balance) && !(code in scope)) {
        scope[code] = Number(row.balance);
      }
    }
  }
  if (markets?.amm?.price != null && Number.isFinite(Number(markets.amm.price))) {
    scope.xio_mark = Number(markets.amm.price);
  }
  if (markets?.amm?.xrpUsd != null && Number.isFinite(Number(markets.amm.xrpUsd))) {
    scope.xrp_usd = Number(markets.amm.xrpUsd);
  }
  if (markets?.orderbook?.mid != null && Number.isFinite(Number(markets.orderbook.mid))) {
    scope.book_mid = Number(markets.orderbook.mid);
  }
  if (lpEarnings?.ok && Array.isArray(lpEarnings.positions)) {
    const held = lpEarnings.positions.filter((r) => r.ok && r.lp > 0);
    if (held[0]?.share_pct != null) scope.lp_share_pct = Number(held[0].share_pct);
    if (held[0]?.lp != null) scope.lp_balance = Number(held[0].lp);
  }
  return scope;
}

/**
 * Detect whether the user is asking for a calculation / desk math.
 */
export function looksLikeMathQuestion(raw) {
  const q = String(raw || "").toLowerCase();
  if (!q.trim()) return false;
  if (
    /\b\d+(\.\d+)?\s*%\s*of\b/.test(q) ||
    /\bpercent(?:age)?\s+of\b/.test(q) ||
    /\b\d+(\.\d+)?\s*percent\s+of\b/.test(q)
  ) {
    return true;
  }
  if (/\b(compound|compounding)\b/.test(q) && /\b(day|days|daily|%|percent)\b/.test(q)) return true;
  if (/\b(basis\s*points?|\bbps\b)\b/.test(q)) return true;
  if (/\b(drawdown|risk\s*[:=/]\s*reward|r\s*:\s*r)\b/.test(q)) return true;
  if (/\b(fee\s*split|pool\s*share|lp\s*share|notional\s*(size|value)?)\b/.test(q) && /\b(\d|%|percent|of|calc|compute)\b/.test(q)) {
    return true;
  }
  if (/\b(calculate|compute|math|work out|figure out)\b/.test(q) && /[\d%]/.test(q)) return true;
  if (/\bwhat(?:'s| is|s)\s+[\d$]/.test(q) && /[\d%]/.test(q)) return true;
  // Bare arithmetic: 12 * 1.2, (34+10)/2
  if (/[\d)]\s*[+\-*/^]\s*[\d(]/.test(q) && !/\b(agent|prime|flux|vector|vortex|echo)\b/.test(q)) return true;
  return false;
}

/**
 * Whether math intent needs live wallet balances bound.
 */
export function mathNeedsWallet(raw) {
  const q = String(raw || "").toLowerCase();
  return /\b(my|me|i |wallet|balance|holding|xrp balance|xio balance)\b/.test(q);
}

/**
 * Whether math intent should pull board marks / LP context.
 */
export function mathNeedsMarkets(raw) {
  const q = String(raw || "").toLowerCase();
  return /\b(mark|price|pool|lp|notional|share|fee|xio|depth)\b/.test(q);
}

/**
 * Parse natural-language desk math into a structured computation.
 */
export function parseMathIntent(raw, scope = {}) {
  const text = String(raw || "").trim();
  const q = text.toLowerCase();

  // percent of: "20% of 150", "what's 20% of my xrp balance"
  {
    const m =
      text.match(/(\d+(?:\.\d+)?)\s*%\s*of\s+(?:my\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b/i) ||
      text.match(/(\d+(?:\.\d+)?)\s*percent\s+of\s+(?:my\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b/i) ||
      text.match(/(\d+(?:\.\d+)?)\s*%\s*of\s+\$?\s*([\d,]+(?:\.\d+)?[kmb]?)/i) ||
      text.match(/(\d+(?:\.\d+)?)\s*percent\s+of\s+\$?\s*([\d,]+(?:\.\d+)?[kmb]?)/i);
    if (m) {
      const pct = Number(m[1]);
      let base = null;
      let baseLabel = m[2];
      const key = String(m[2]).toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (key in scope) {
        base = scope[key];
        baseLabel = key;
      } else if (/xrp/.test(key) && scope.xrp != null) {
        base = scope.xrp;
        baseLabel = "xrp";
      } else if (/xio/.test(key) && scope.xio != null) {
        base = scope.xio;
        baseLabel = "xio";
      } else {
        base = parseNumberToken(m[2]);
        baseLabel = formatNum(base);
      }
      if (base != null && Number.isFinite(pct)) {
        const value = (pct / 100) * base;
        return {
          ok: true,
          kind: "percent_of",
          value,
          method: `${pct}% of ${baseLabel} (${formatNum(base)}) = ${formatNum(value)}`,
          inputs: { pct, base },
        };
      }
      if (base == null && /xrp|xio|balance|wallet/.test(q)) {
        return { ok: false, error: "need_balance_binding", kind: "percent_of", pct };
      }
    }
  }

  // compound: "compound 20% for 7 days from $34" / "compound 20% daily for 7 days starting at 34"
  {
    const m = text.match(
      /compound\s+(\d+(?:\.\d+)?)\s*%\s*(?:daily\s+)?(?:for\s+)?(\d+)\s*days?\s*(?:from|starting(?:\s+at)?|on)?\s*\$?\s*([\d,]+(?:\.\d+)?)/i
    ) ||
      text.match(
        /(?:from|starting(?:\s+at)?)\s*\$?\s*([\d,]+(?:\.\d+)?).{0,40}compound\s+(\d+(?:\.\d+)?)\s*%.{0,20}(\d+)\s*days?/i
      );
    if (m) {
      let start;
      let pct;
      let days;
      if (/^compound/i.test(m[0])) {
        pct = Number(m[1]);
        days = Number(m[2]);
        start = parseNumberToken(m[3]);
      } else {
        start = parseNumberToken(m[1]);
        pct = Number(m[2]);
        days = Number(m[3]);
      }
      const value = compoundDaily(start, pct / 100, days);
      if (value != null) {
        return {
          ok: true,
          kind: "compound_daily",
          value,
          method: `Compound +${pct}% daily for ${days} days from ${formatNum(start)} → ${formatNum(value)} (start × (1+${pct}/100)^${days})`,
          inputs: { start, pct, days },
          milestones: Array.from({ length: Math.min(days, 14) }, (_, i) => {
            const d = i + 1;
            return { day: d, value: compoundDaily(start, pct / 100, d) };
          }),
        };
      }
    }
  }

  // bps: "80 bps of 10000" or "what is 25 bps"
  {
    const ofM = text.match(/(\d+(?:\.\d+)?)\s*(?:basis\s*points?|bps)\s*(?:of|on)\s*\$?\s*([\d,]+(?:\.\d+)?[kmb]?)/i);
    if (ofM) {
      const bps = Number(ofM[1]);
      const notional = parseNumberToken(ofM[2]);
      const value = notional != null ? notional * (bps / 10_000) : null;
      if (value != null) {
        return {
          ok: true,
          kind: "bps_of",
          value,
          method: `${bps} bps of ${formatNum(notional)} = ${formatNum(value)}`,
          inputs: { bps, notional },
        };
      }
    }
    const alone = text.match(/(\d+(?:\.\d+)?)\s*(?:basis\s*points?|bps)\b/i);
    if (alone && /\b(what|how much|convert|as percent|in percent|to percent)\b/i.test(q)) {
      const bps = Number(alone[1]);
      const value = bps / 100; // as percent
      return {
        ok: true,
        kind: "bps_to_pct",
        value,
        method: `${bps} bps = ${formatNum(value)}% (${formatNum(bps / 10_000)} as a fraction)`,
        inputs: { bps },
      };
    }
  }

  // LP share: "lp share 1200 of 50000" / "pool share 1200 / 50000"
  {
    const m = text.match(
      /(?:lp|pool)\s*share\s*(?:of\s*)?([\d,]+(?:\.\d+)?)\s*(?:of|\/|out of)\s*([\d,]+(?:\.\d+)?)/i
    );
    if (m) {
      const owned = parseNumberToken(m[1]);
      const total = parseNumberToken(m[2]);
      const value = lpSharePct(owned, total);
      if (value != null) {
        return {
          ok: true,
          kind: "lp_share",
          value,
          method: `LP share ${formatNum(owned)} / ${formatNum(total)} = ${formatNum(value)}%`,
          inputs: { owned, total },
        };
      }
    }
  }

  // fee split: "fee split volume 100000 fee 0.3% share 2%"
  {
    const vol = text.match(/volume\s*[=:]?\s*\$?\s*([\d,]+(?:\.\d+)?[kmb]?)/i);
    const fee = text.match(/fee\s*[=:]?\s*(\d+(?:\.\d+)?)\s*%/i);
    const share = text.match(/share\s*[=:]?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (/\bfee\s*split\b/i.test(text) && vol && fee && share) {
      const volume = parseNumberToken(vol[1]);
      const feeRate = Number(fee[1]) / 100;
      const shareFrac = Number(share[1]) / 100;
      const value = feeSplitEstimate(volume, feeRate, shareFrac);
      if (value != null) {
        return {
          ok: true,
          kind: "fee_split",
          value,
          method: `Fee split ≈ volume ${formatNum(volume)} × fee ${fee[1]}% × share ${share[1]}% = ${formatNum(value)}`,
          inputs: { volume, feeRate, shareFrac },
        };
      }
    }
  }

  // notional: "notional 500 xio at 0.02" / "notional size 1000 @ 1.25"
  {
    const m = text.match(/notional(?:\s*size|\s*value)?\s*(?:of\s*)?([\d,]+(?:\.\d+)?)\s*(?:xio|units?)?\s*(?:at|@|×|x|\*)\s*([\d,]+(?:\.\d+)?)/i);
    if (m) {
      const units = parseNumberToken(m[1]);
      const mark = parseNumberToken(m[2]);
      const value = notionalSize(units, mark);
      if (value != null) {
        return {
          ok: true,
          kind: "notional",
          value,
          method: `Notional ${formatNum(units)} × mark ${formatNum(mark)} = ${formatNum(value)}`,
          inputs: { units, mark },
        };
      }
    }
  }

  // drawdown: "drawdown from 100 to 82"
  {
    const m = text.match(/drawdown\s*(?:from\s*)?([\d,]+(?:\.\d+)?)\s*(?:to|→|->)\s*([\d,]+(?:\.\d+)?)/i);
    if (m) {
      const peak = parseNumberToken(m[1]);
      const trough = parseNumberToken(m[2]);
      const value = drawdownPct(peak, trough);
      if (value != null) {
        return {
          ok: true,
          kind: "drawdown",
          value,
          method: `Drawdown from ${formatNum(peak)} to ${formatNum(trough)} = ${formatNum(value)}%`,
          inputs: { peak, trough },
        };
      }
    }
  }

  // R:R "r:r entry 10 stop 9 target 13" or "risk reward 1.5 to 4.5"
  {
    const m = text.match(
      /(?:r\s*:\s*r|risk\s*[:=/]\s*reward|risk\s*reward)\s*(?:entry\s*)?([\d,]+(?:\.\d+)?)\s*(?:stop\s*)?([\d,]+(?:\.\d+)?)\s*(?:target\s*)?([\d,]+(?:\.\d+)?)/i
    );
    if (m) {
      const entry = parseNumberToken(m[1]);
      const stop = parseNumberToken(m[2]);
      const target = parseNumberToken(m[3]);
      const value = riskReward(entry, stop, target);
      if (value != null) {
        return {
          ok: true,
          kind: "risk_reward",
          value,
          method: `R:R entry ${formatNum(entry)} / stop ${formatNum(stop)} / target ${formatNum(target)} = ${formatNum(value)}`,
          inputs: { entry, stop, target },
        };
      }
    }
  }

  // Raw expression in backticks or after equals / calculate
  {
    const exprMatch =
      text.match(/`([^`]+)`/) ||
      text.match(/(?:calculate|compute|eval(?:uate)?|math)\s*[:=]?\s*([0-9+\-*/%^().\s]+)/i) ||
      text.match(/^\s*([0-9+\-*/%^().\s]{3,})\s*$/);
    if (exprMatch) {
      const ev = safeEvaluate(exprMatch[1], scope);
      if (ev.ok) {
        return {
          ok: true,
          kind: "expression",
          value: ev.value,
          method: `${ev.expression} = ${formatNum(ev.value)}`,
          inputs: { expression: ev.expression },
        };
      }
    }
  }

  // Fallback: extract first arithmetic substring
  {
    const m = text.match(/(\d[\d,]*\.?\d*\s*[+\-*/^]\s*\d[\d,]*\.?\d*(?:\s*[+\-*/^]\s*\d[\d,]*\.?\d*)*)/);
    if (m) {
      const ev = safeEvaluate(m[1].replace(/,/g, ""), scope);
      if (ev.ok) {
        return {
          ok: true,
          kind: "expression",
          value: ev.value,
          method: `${ev.expression} = ${formatNum(ev.value)}`,
          inputs: { expression: ev.expression },
        };
      }
    }
  }

  return { ok: false, error: "unparsed", kind: null };
}

/**
 * Build a calm British Commander reply for a math result.
 */
export function formatMathReply(result, { scope = {}, askedWallet = false } = {}) {
  if (!result) {
    return "I could not run that calculation cleanly. Try a clearer form such as 20% of 150, or compound 20% for 7 days from 34.";
  }
  if (!result.ok) {
    if (result.error === "need_balance_binding" || askedWallet) {
      return "Connect your wallet on this exchange (or paste a classic r… address) and I will bind live balances into the calc. I never need your seed.";
    }
    return "I could not parse that into safe desk math. Examples: what is 20% of 500; compound 20% for 7 days from 34; 25 bps of 10000; lp share 1200 of 50000.";
  }

  const bits = [];
  bits.push(`Computed: ${formatNum(result.value)}.`);
  if (result.method) bits.push(`Method: ${result.method}.`);
  if (result.kind === "compound_daily" && Array.isArray(result.milestones) && result.milestones.length > 1) {
    const last = result.milestones[result.milestones.length - 1];
    const mid = result.milestones[Math.min(2, result.milestones.length - 1)];
    bits.push(`Milestone day ${mid.day}: ${formatNum(mid.value)}; day ${last.day}: ${formatNum(last.value)}.`);
    bits.push("Desk framing uses about +20% daily yield versus day-start mark, not leverage fantasy.");
  }
  if (result.kind === "percent_of" && scope && Object.keys(scope).length) {
    bits.push("Live wallet/board numbers used where available.");
  }
  return bits.join(" ").replace(/\u2014/g, ". ").replace(/\u2013/g, "-");
}

/**
 * High-level: detect, bind, compute, format.
 */
export function runCommanderMath(raw, { balances = null, markets = null, lpEarnings = null } = {}) {
  const scope = bindLiveScope(balances, markets, lpEarnings);
  const parsed = parseMathIntent(raw, scope);
  const text = formatMathReply(parsed, { scope, askedWallet: mathNeedsWallet(raw) && !balances?.ok });
  return {
    ok: !!parsed?.ok,
    intent: "math",
    parsed,
    scope,
    text,
  };
}

export default {
  safeEvaluate,
  looksLikeMathQuestion,
  mathNeedsWallet,
  mathNeedsMarkets,
  parseMathIntent,
  bindLiveScope,
  runCommanderMath,
  formatMathReply,
  toBps,
  fromBps,
  pctChange,
  compoundDaily,
  lpSharePct,
  feeSplitEstimate,
  notionalSize,
  drawdownPct,
  riskReward,
};
