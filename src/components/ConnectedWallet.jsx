import {useEffect, useMemo, useRef, useState} from "react";
import {getConnectedWallet, loadWalletLpIncomeHistory} from "../api/indexer";
import {pendingVoteFromExecution} from "../wallet/ammVote";
import {useWallet} from "../context/useWallet";
import {useI18n} from "../i18n/useI18n";
import {formatEur, formatGbp, formatJpy, formatNumber, formatQuotePerBase, formatSharePercent, formatSupplySharePercent, formatToken, formatUsd, shortAddress} from "../utils/format";
import {copyToClipboard} from "../utils/copy";
import {emptyWalletSnapshot, normalizeWalletPair, withdrawQuoteLabel, preferFilledWalletSnapshot, preferredWalletPair, sortWalletPairs, xrpBarPercents} from "../wallet/composeWallet";
import {formatFeePercent} from "../wallet/ammVote";
import {useMorph} from "../wallet/useMorph";
import {displayTrustlinePair, mergeWalletActivity, mergeWalletOrders, pendingFromExecution} from "../wallet/ledgerOrders";
import {INCOME_ALL_PAIRS, INCOME_PAGE_DAYS, isAllIncomePairs, downloadTextFile, incomeDayKeys, incomePairChoices, incomePairTotals, incomeRowsForPair, lpIncomeCsv, mergeFrozenFees, pageLpIncome, readRecordedLpIncome, remapIncomeActivity, writeRecordedLpIncome} from "../wallet/lpIncome";

function XrpColumn({ label, tone, percent, value, locale, empty }) {
  return (
    <div className="wallet-xrp-col">
      <div className="wallet-xrp-bar" aria-hidden="true">
        <span className={tone} style={{ height: `${empty ? 0 : percent}%` }} />
      </div>
      <small>{label}</small>
      <b>{empty ? "—" : formatToken(value, locale, 4)}</b>
    </div>
  );
}

function XrpBalanceBars({ xrp, locale, t, empty }) {
  const unknown = empty || xrp?.balance == null;
  const spendable = useMorph(unknown ? 0 : xrp.spendable);
  const reserved = useMorph(unknown ? 0 : xrp.reserved);
  const total = useMorph(unknown ? 0 : xrp.balance);
  const bars = xrpBarPercents(
    { reserved, spendable, total },
    !unknown
  );

  return (
    <div className={`wallet-panel${unknown ? " is-empty" : " is-filled"}`}>
      <p className="wallet-panel-title is-center">{t.xrpBalance}</p>
      <div className="wallet-xrp-bars">
        <XrpColumn
          label={t.reservedXrp}
          tone="is-reserve"
          percent={bars.reservePct}
          value={reserved}
          locale={locale}
          empty={unknown}
        />
        <XrpColumn
          label={t.spendableXrp}
          tone="is-spend"
          percent={bars.spendPct}
          value={spendable}
          locale={locale}
          empty={unknown}
        />
        <XrpColumn
          label={t.totalXrp}
          tone="is-total"
          percent={bars.totalPct}
          value={total}
          locale={locale}
          empty={unknown}
        />
      </div>
    </div>
  );
}

function XioBalancePanel({ xio, locale, t, empty }) {
  const rows = [
    { id: "xio", label: t.xio, value: empty ? "—" : formatToken(xio?.xio, locale, 2) },
    { id: "xrp", label: t.xrp, value: empty ? "—" : formatToken(xio?.xrp, locale, 4) },
    { id: "rlusd", label: t.rlusd || "RLUSD", value: empty ? "—" : formatToken(xio?.rlusd, locale, 2) },
    { id: "usd", label: t.usd, value: empty ? "—" : formatUsd(xio.usd, locale) },
    { id: "gbp", label: t.gbp, value: empty ? "—" : formatGbp(xio.gbp, locale) },
    { id: "eur", label: t.eur, value: empty ? "—" : formatEur(xio.eur, locale) },
    { id: "jpy", label: t.jpy, value: empty ? "—" : formatJpy(xio.jpy, locale) },
  ];
  return (
    <div className={`wallet-panel${empty ? " is-empty" : " is-filled"}`}>
      <p className="wallet-panel-title is-center">{t.xioValue}</p>
      <dl className="wallet-mini-list">
        {rows.map((row) => (
          <div key={row.id}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SupplyShareBars({ supply, locale, t, empty }) {
  const circ = useMorph(empty ? 0 : supply.circulatingPct);
  const supplyPct = useMorph(empty ? 0 : supply.supplyPct);
  const circWidth = empty ? 0 : Math.min(100, Math.max(Number(circ) > 0 ? 4 : 0, Number(circ)));
  const supplyWidth = empty
    ? 0
    : Math.min(100, Math.max(Number(supplyPct) > 0 ? 4 : 0, Number(supplyPct)));
  return (
    <div className={`wallet-panel wallet-share${empty ? " is-empty" : " is-filled"}`}>
      <p className="wallet-panel-title is-center">{t.supplyShare}</p>
      <div className="wallet-micro">
        <span>{t.circulating}</span>
        <b>{empty ? "—" : formatSharePercent(circ, locale)}</b>
        <span className="wallet-micro-track">
          <i style={{ width: `${circWidth}%` }} />
        </span>
      </div>
      <div className="wallet-micro">
        <span>{t.xioSupplyShare}</span>
        <b>{empty ? "—" : formatSupplySharePercent(supplyPct, locale)}</b>
        <span className="wallet-micro-track">
          <i className="is-amm" style={{ width: `${supplyWidth}%` }} />
        </span>
      </div>
      <div className="wallet-micro is-pending">
        <span>{t.borrowed}</span>
        <b>—</b>
        <span className="wallet-micro-track">
          <i style={{ width: 0 }} />
        </span>
      </div>
      <div className="wallet-micro is-pending">
        <span>{t.lending}</span>
        <b>—</b>
        <span className="wallet-micro-track">
          <i style={{ width: 0 }} />
        </span>
      </div>
    </div>
  );
}

function PoolWindowValue({ pool, window, locale, empty }) {
  if (empty || !pool) return "—";
  const xio = window === "7d" ? pool.xio7d : pool.xio24h;
  const quote = window === "7d" ? pool.quote7d : pool.quote24h;
  const usd = window === "7d" ? pool.usd7d : pool.usd24h;
  const quoteLabel = pool.quote || "";
  const hasXio = Number(xio) > 0;
  const hasQuote = Number(quote) > 0;
  if (!hasXio && !hasQuote && !(Number(usd) > 0)) return "—";
  return (
    <span className="wallet-lp-earn wallet-income-assets">
      {hasXio ? (
        <>
          <b className="wallet-income-amt wallet-asset-amt">{formatToken(xio, locale, 2)}</b>
          <span className="wallet-income-ticker wallet-asset-ticker">XIO</span>
        </>
      ) : null}
      {hasQuote ? (
        <>
          <b className="wallet-income-amt wallet-asset-amt">{formatToken(quote, locale, 4)}</b>
          <span className="wallet-income-ticker wallet-asset-ticker">{quoteLabel}</span>
        </>
      ) : null}
      {Number(usd) > 0 ? <i className="wallet-earn-usd">{formatUsd(usd, locale)}</i> : null}
    </span>
  );
}

function LpInfographic({ position, earn, locale, t, empty }) {
  const share = useMorph(empty ? 0 : position?.lp_share_percent);
  const xioComp = useMorph(empty ? 0 : position?.composition_xio_percent);
  const quoteComp = useMorph(empty ? 0 : position?.composition_quote_percent);
  const shareWidth = empty ? 0 : Math.min(100, Math.max(Number(share) > 0 ? 6 : 0, Number(share) * 8));
  return (
    <div className={`wallet-lp-info${empty ? " is-empty" : " is-filled"}`}>
      <div className="wallet-micro">
        <span>{t.lpShare}</span>
        <span className="wallet-micro-track">
          <i style={{ width: `${shareWidth}%` }} />
        </span>
        <b>{empty ? "—" : formatSharePercent(share, locale)}</b>
      </div>
      <div className="wallet-lp-comp" aria-hidden="true">
        <span className="is-xio" style={{ width: `${empty ? 0 : Number(xioComp) || 0}%` }} />
        <span className="is-quote" style={{ width: `${empty ? 0 : Number(quoteComp) || 0}%` }} />
      </div>
      <dl className="wallet-mini-list is-wide">
        <div>
          <dt>{t.lp}</dt>
          <dd>{empty ? "—" : formatToken(position?.lp_balance, locale, 2)}</dd>
        </div>
        <div>
          <dt>{t.withdrawXio}</dt>
          <dd>{empty ? "—" : formatToken(position?.withdraw_estimate_xio, locale, 2)}</dd>
        </div>
        <div>
          <dt>{withdrawQuoteLabel(position?.quote, t.withdrawQuote)}</dt>
          <dd>
            {empty
              ? "—"
              : `${formatToken(position?.withdraw_estimate_quote, locale, 4)} ${position?.quote || ""}`.trim()}
          </dd>
        </div>
        <div>
          <dt>{t.lpFees24h}</dt>
          <dd>
            <PoolWindowValue pool={earn} window="24h" locale={locale} empty={empty} />
          </dd>
        </div>
        <div>
          <dt>{t.lpFees7d}</dt>
          <dd>
            <PoolWindowValue pool={earn} window="7d" locale={locale} empty={empty} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function WalletIncomePanel({ address, snapshotRows, positions, pools, priceBook, locale, t, empty }) {
  const [incomePair, setIncomePair] = useState(INCOME_ALL_PAIRS);
  const [historyActivity, setHistoryActivity] = useState(null);
  const [historyDays, setHistoryDays] = useState([]);
  const [recordedRows] = useState(() => readRecordedLpIncome(address));
  const [loading, setLoading] = useState(() => Boolean(address) && !empty);
  const [historyComplete, setHistoryComplete] = useState(false);
  const [daysShown, setDaysShown] = useState(INCOME_PAGE_DAYS);
  const [epoch, setEpoch] = useState(0);
  const cacheRef = useRef(new Map());
  const sentinelRef = useRef(null);
  const historyRows = remapIncomeActivity(historyActivity, positions, pools);
  const pairs = incomePairChoices({ positions });
  const selectedPair = pairs.includes(incomePair) ? incomePair : INCOME_ALL_PAIRS;
  const all = incomeRowsForPair({
    pair: selectedPair,
    snapshotRows,
    historyActivity: historyRows,
    historyDays,
    recordedRows,
    positions,
    pools,
    prices: priceBook,
    xioUsd: priceBook?.xioUsd,
    xrpUsd: priceBook?.xrpUsd,
    rlusdUsd: priceBook?.RLUSD,
  });
  const totals = incomePairTotals({
    pair: selectedPair,
    positions,
    pools,
    activity: historyRows,
    prices: priceBook,
    xioUsd: priceBook?.xioUsd,
    xrpUsd: priceBook?.xrpUsd,
    rlusdUsd: priceBook?.RLUSD,
  });
  const allPairs = isAllIncomePairs(selectedPair);
  const dayCount = incomeDayKeys(all).length;
  const visible = allPairs ? all : pageLpIncome(all, daysShown);
  const pagedOut = empty || allPairs || dayCount === 0 || daysShown >= dayCount;
  const done = pagedOut && !loading && (empty || allPairs || historyComplete);

  useEffect(() => {
    if (!address || empty) return undefined;
    const key = address;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setHistoryActivity(cached.activity);
      setHistoryDays(Array.isArray(cached.days) ? cached.days : []);
      setHistoryComplete(cached.complete);
      setLoading(!cached.complete);
      if (cached.complete) return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setHistoryComplete(false);
    loadWalletLpIncomeHistory(address, {
      fresh: epoch > 0,
      onPage: (partial) => {
        if (cancelled) return;
        cacheRef.current.set(key, partial);
        setHistoryActivity(partial.activity);
        setHistoryDays(Array.isArray(partial.days) ? partial.days : []);
        setHistoryComplete(false);
      },
    })
      .then((result) => {
        if (cancelled) return;
        cacheRef.current.set(key, result);
        setHistoryActivity(result.activity);
        setHistoryDays(Array.isArray(result.days) ? result.days : []);
        setHistoryComplete(result.complete);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, empty, epoch]);

  useEffect(() => {
    if (!address) return undefined;
    function bust() {
      for (const key of [...cacheRef.current.keys()]) {
        if (key.startsWith(`${address}:`)) cacheRef.current.delete(key);
      }
      setEpoch((current) => current + 1);
    }
    window.addEventListener("dpmf-wallet-refresh", bust);
    window.addEventListener("dpmf-trade-executed", bust);
    window.addEventListener("dpmf-function-confirmed", bust);
    return () => {
      window.removeEventListener("dpmf-wallet-refresh", bust);
      window.removeEventListener("dpmf-trade-executed", bust);
      window.removeEventListener("dpmf-function-confirmed", bust);
    };
  }, [address]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || pagedOut) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setDaysShown((current) => current + INCOME_PAGE_DAYS);
        }
      },
      { root: node.parentElement, rootMargin: "24px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [pagedOut, daysShown]);

  function onPairChange(next) {
    setIncomePair(next);
    setDaysShown(INCOME_PAGE_DAYS);
  }

  useEffect(() => {
    if (!address || empty || !all.length) return;
    if (allPairs || all.some((row) => row.kind === "hold")) return;
    writeRecordedLpIncome(address, mergeFrozenFees(readRecordedLpIncome(address), all));
  }, [address, empty, all, allPairs]);

  return (
    <section className={`wallet-book wallet-income${empty ? " is-empty" : " is-filled"}`}>
      <div className="wallet-income-head">
        <h3>{t.lpPassiveIncome || "POOL EARNING/PASSIVE INCOME"}</h3>
        <div className="wallet-income-tools">
          <label className="wallet-lp-select wallet-income-select">
            <span className="sr-only">{t.incomePairSelect || t.incomePair || "Pair"}</span>
            <select
              value={selectedPair}
              disabled={empty}
              aria-label={t.incomePairSelect || t.incomePair || "Pair"}
              onChange={(event) => onPairChange(event.target.value)}
            >
              {pairs.map((name) => (
                <option key={name} value={name}>
                  {name === INCOME_ALL_PAIRS ? t.incomeAllPairs || "All pairs" : name}
                </option>
              ))}
            </select>
          </label>
          <div className="wallet-income-totals">
            <p className="wallet-income-total is-usd" aria-label={t.incomeUsd || "USD"}>
              {empty || !(totals.usd > 0) ? "—" : formatUsd(totals.usd, locale)}
            </p>
          </div>
          <button
            type="button"
            className="copy-btn wallet-income-copy"
            disabled={empty || !all.length}
            onClick={() => downloadTextFile("lp-earnings.csv", lpIncomeCsv(all))}
            aria-label={t.downloadLpIncome || "Download LP earnings"}
          >
            {t.copy || "Copy"}
          </button>
        </div>
      </div>
      {loading ? (
        <div
          className="wallet-income-load"
          role="progressbar"
          aria-label={t.loadingLpIncome || "Loading LP history"}
        >
          <span />
        </div>
      ) : null}
      <div className="wallet-income-scroll">
        <table className="wallet-income-table">
          <thead>
            <tr>
              <th>{allPairs ? t.incomePair || "Pair" : t.incomeDate || "Date"}</th>
              <th>{t.incomePoolShareAssets || "Assets"}</th>
              <th>{t.incomeUsd || "USD"}</th>
            </tr>
          </thead>
          <tbody>
            {empty || !visible.length ? (
              <tr>
                <td colSpan={3}>
                  {empty ? "—" : allPairs ? t.noLpPositions || "No LP positions" : t.noLpIncome || "No LP earnings yet"}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const hold = row.kind === "hold" || allPairs;
                const assetXio = Number(row.assetXio) || 0;
                const assetQuote = Number(row.assetQuote) || 0;
                const hasAssets = assetXio > 0 || assetQuote > 0;
                const quoteLabel = row.quoteAsset || String(row.pair || "").split("/")[1] || "";
                return (
                  <tr key={`${row.date || "hold"}-${row.pair}-${assetXio}-${assetQuote}-${row.usd || 0}`}>
                    <td>
                      {hold ? (
                        <span className="wallet-income-day">{row.pair}</span>
                      ) : (
                        <span className="wallet-income-day">{row.date}</span>
                      )}
                    </td>
                    <td className={hold ? "is-lp is-pool-share" : "is-lp-add is-pool-share"}>
                      {hasAssets ? (
                        <span className="wallet-income-assets">
                          <b className="wallet-income-amt wallet-asset-amt">
                            {hold ? null : <span className="is-plus">+</span>}
                            {formatToken(assetXio, locale, 4)}
                          </b>
                          <span className="wallet-income-ticker wallet-asset-ticker">XIO</span>
                          <b className="wallet-income-amt wallet-asset-amt">
                            {hold ? null : <span className="is-plus">+</span>}
                            {formatToken(assetQuote, locale, 4)}
                          </b>
                          <span className="wallet-income-ticker wallet-asset-ticker">{quoteLabel}</span>
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                    <td className="is-earn">{hasAssets && Number(row.usd) > 0 ? formatUsd(row.usd, locale) : ""}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {done ? (
          <p className="wallet-income-end">{empty ? "" : t.incomeEnd || "end"}</p>
        ) : (
          <div ref={sentinelRef} className="wallet-income-more" aria-hidden="true" />
        )}
      </div>
    </section>
  );
}

function earnText(value, format, empty) {
  if (empty || value == null || !Number.isFinite(Number(value))) return "—";
  return format(Number(value));
}

function earnAmount(amount, usd, locale, digits, empty) {
  return {
    amount: earnText(amount, (n) => formatToken(n, locale, digits), empty),
    usd: earnText(usd, (n) => formatUsd(n, locale), empty),
  };
}

function WalletEarnCell({ label, rows, empty, className = "", usdOnly = false, t }) {
  return (
    <div
      className={`wallet-earn-cell${empty ? " is-empty" : " is-filled"}${usdOnly ? " is-usd-only" : ""}${className ? ` ${className}` : ""}`}
    >
      <p className="wallet-earn-label">{label}</p>
      <div className="wallet-earn-grid">
        <p className="wallet-earn-row is-head">
          <span className="wallet-earn-range" aria-hidden="true" />
          {usdOnly ? null : <span className="wallet-earn-col-lp">{t?.incomeLpTokens || t?.incomePoolShareAssets || "Amount"}</span>}
          <span className="wallet-earn-col-usd">{t?.incomeUsd || "USD"}</span>
        </p>
        {rows.map((row) => (
          <p key={row.range} className="wallet-earn-row">
            <span className="wallet-earn-range">{row.range}</span>
            {usdOnly ? (
              <b className="wallet-earn-usd">{row.amount}</b>
            ) : (
              <>
                <b className="wallet-earn-lp">{row.amount}</b>
                <i className="wallet-earn-usd">{row.usd}</i>
              </>
            )}
          </p>
        ))}
      </div>
    </div>
  );
}

function WalletEarnBeam({ fees, locale, t, empty }) {
  const earn = fees?.earnings || {};
  const xrp24 = earnAmount(earn.xrp24h, earn.xrp24hUsd, locale, 4, empty);
  const xrp7 = earnAmount(earn.xrp7d, earn.xrp7dUsd, locale, 4, empty);
  const xio24 = earnAmount(earn.xio24h, earn.xio24hUsd, locale, 2, empty);
  const xio7 = earnAmount(earn.xio7d, earn.xio7dUsd, locale, 2, empty);
  const rlusd24 = earnAmount(earn.rlusd24h, earn.rlusd24hUsd, locale, 4, empty);
  const rlusd7 = earnAmount(earn.rlusd7d, earn.rlusd7dUsd, locale, 4, empty);
  return (
    <section className="wallet-earn-board" aria-label={t.lpFeeEarnings}>
      <h3 className="wallet-earn-title">{t.lpFeeEarnings}</h3>
      <div className="wallet-earn-beam">
        <WalletEarnCell
          className="wallet-earn-xrp"
          label={t.xrp}
          empty={empty}
          t={t}
          rows={[
            { range: t.lpFees24h, amount: xrp24.amount, usd: xrp24.usd },
            { range: t.lpFees7d, amount: xrp7.amount, usd: xrp7.usd },
          ]}
        />
        <WalletEarnCell
          className="wallet-earn-xio"
          label={t.xio}
          empty={empty}
          t={t}
          rows={[
            { range: t.lpFees24h, amount: xio24.amount, usd: xio24.usd },
            { range: t.lpFees7d, amount: xio7.amount, usd: xio7.usd },
          ]}
        />
        <WalletEarnCell
          className="wallet-earn-rlusd"
          label={t.rlusd || "RLUSD"}
          empty={empty}
          t={t}
          rows={[
            { range: t.lpFees24h, amount: rlusd24.amount, usd: rlusd24.usd },
            { range: t.lpFees7d, amount: rlusd7.amount, usd: rlusd7.usd },
          ]}
        />
        <WalletEarnCell
          className="wallet-earn-total"
          label={t.totalEarnings}
          empty={empty}
          usdOnly
          t={t}
          rows={[
            { range: t.lpFees24h, amount: earnText(earn.usd24h, (n) => formatUsd(n, locale), empty) },
            { range: t.lpFees7d, amount: earnText(earn.usd7d, (n) => formatUsd(n, locale), empty) },
          ]}
        />
      </div>
    </section>
  );
}

export default function ConnectedWallet() {
  const { t, locale } = useI18n();
  const { walletAddress } = useWallet();
  const [snap, setSnap] = useState(() => emptyWalletSnapshot(null));
  const [pair, setPair] = useState("XIO/XRP");

  useEffect(() => {
    if (!walletAddress) return undefined;
    let cancelled = false;

    async function load(fresh = false) {
      const next = await getConnectedWallet(walletAddress, { fresh }).catch(() =>
        emptyWalletSnapshot(walletAddress)
      );
      if (cancelled) return;
      setSnap((current) => preferFilledWalletSnapshot(current, next));
      setPair((current) => {
        const pairs = next.lp.map((row) => row.pool);
        if (!pairs.length) return current;
        return preferredWalletPair(pairs, current);
      });
    }

    load();
    const retries = [];
    retries.push(window.setTimeout(() => load(false), 800));
    retries.push(window.setTimeout(() => load(true), 2800));
    const id = setInterval(load, 30000);
    function refreshConfirmed() {
      load(true);
      retries.push(window.setTimeout(() => load(true), 2500));
      retries.push(window.setTimeout(() => load(true), 8000));
    }
    function applyPending(detail) {
      const pending =
        pendingFromExecution(detail, walletAddress) || pendingVoteFromExecution(detail, walletAddress);
      if (!pending) return;
      setSnap((current) => ({
        ...current,
        signedIn: true,
        filled: true,
        orders: mergeWalletOrders(pending.order ? [pending.order] : [], current.orders || []),
        activity: mergeWalletActivity(pending.activity ? [pending.activity] : [], current.activity || []).slice(
          0,
          3
        ),
      }));
    }
    function onRefresh() {
      load(true);
    }
    function onTrade(event) {
      applyPending(event.detail);
      refreshConfirmed();
    }
    window.addEventListener("dpmf-wallet-refresh", onRefresh);
    window.addEventListener("dpmf-trade-executed", onTrade);
    window.addEventListener("dpmf-function-confirmed", onTrade);
    return () => {
      cancelled = true;
      clearInterval(id);
      for (const timer of retries) window.clearTimeout(timer);
      window.removeEventListener("dpmf-wallet-refresh", onRefresh);
      window.removeEventListener("dpmf-trade-executed", onTrade);
      window.removeEventListener("dpmf-function-confirmed", onTrade);
    };
  }, [walletAddress]);

  const view = walletAddress ? snap : emptyWalletSnapshot(null);
  const empty = !view.signedIn || !view.filled;
  const pools = sortWalletPairs(view.lp.map((row) => row.pool));
  const selected = normalizeWalletPair(pair);
  const position = useMemo(
    () => view.lp.find((row) => normalizeWalletPair(row.pool) === selected) || null,
    [view.lp, selected]
  );
  return (
    <div className="connected-wallet">
      <header className="wallet-hero">
        <div className="wallet-hero-brand">
          <img src="/mark.png?v=2" alt="" className="wallet-mark" />
          <div className="wallet-hero-copy">
            <p className="wallet-hero-label">{t.xioValue}</p>
            <p className={`wallet-hero-qty${empty ? " is-empty" : " is-filled"}`}>
              {empty ? "—" : `${formatToken(view.xio.xio, locale, 2)} ${t.xio}`}
            </p>
            <p className={`wallet-hero-usd${empty ? " is-empty" : " is-filled"}`}>
              {empty ? "—" : formatUsd(view.xio.usd, locale)}
            </p>
            <div className="wallet-hero-fx">
              <p className={`wallet-hero-gbp${empty ? " is-empty" : " is-filled"}`}>
                {empty ? "—" : formatGbp(view.xio.gbp, locale)}
              </p>
              <p className={`wallet-hero-eur${empty ? " is-empty" : " is-filled"}`}>
                {empty ? "—" : formatEur(view.xio.eur, locale)}
              </p>
              <p className={`wallet-hero-jpy${empty ? " is-empty" : " is-filled"}`}>
                {empty ? "—" : formatJpy(view.xio.jpy, locale)}
              </p>
            </div>
          </div>
        </div>
        {walletAddress ? (
          <div className="wallet-hero-account">
            <button
              type="button"
              className="account-link"
              onClick={() => copyToClipboard(walletAddress)}
            >
              {shortAddress(walletAddress)}
            </button>
            <p className={`wallet-hero-rank${empty || view.rank == null ? " is-empty" : " is-filled"}`}>
              {t.richListPosition}{" "}
              {empty || view.rank == null
                ? "—"
                : `#${formatNumber(view.rank, locale, { maximumFractionDigits: 0 })}`}
            </p>
          </div>
        ) : (
          <p className="wallet-hero-hint">{t.connectWalletHint}</p>
        )}
      </header>

      <div className="wallet-balance-stack">
        <WalletEarnBeam fees={view.fees} locale={locale} t={t} empty={empty} />
        <div className="wallet-infographics">
          <XrpBalanceBars xrp={view.xrp} locale={locale} t={t} empty={empty} />
          <XioBalancePanel xio={view.xio} locale={locale} t={t} empty={empty} />
          <SupplyShareBars supply={view.supply} locale={locale} t={t} empty={empty} />
        </div>
      </div>

      <section className="wallet-lp">
        <div className="wallet-lp-head">
          <h3>{t.lpPositions}</h3>
          <label className="wallet-lp-select">
            <span className="sr-only">{t.pair}</span>
            <select
              value={pair}
              disabled={empty || !pools.length}
              onChange={(event) => setPair(event.target.value)}
            >
              {pools.length ? (
                pools.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              ) : (
                <option value="">{t.noLpPositions}</option>
              )}
            </select>
          </label>
        </div>
        <LpInfographic
          position={position}
          earn={view.fees?.earnings?.pools?.[selected]}
          locale={locale}
          t={t}
          empty={empty || !position}
        />
      </section>

      <WalletIncomePanel
        key={walletAddress || "out"}
        address={walletAddress}
        snapshotRows={view.income}
        positions={view.lp}
        pools={view.pools}
        priceBook={view.priceBook}
        locale={locale}
        t={t}
        empty={!walletAddress}
      />

      <section className={`wallet-activity${empty ? " is-empty" : " is-filled"}`}>
        <h3>{t.recentActivity}</h3>
        <ol>
          {(empty ? [0, 1, 2] : view.activity.concat([null, null, null]).slice(0, 3)).map((row, index) => (
            <li key={row?.timestamp || index}>
              {empty || !row
                ? "—"
                : row.kind === "vote"
                  ? (t.votedOnPool || "Voted on {pair} — {fee} fee")
                      .replace("{pair}", row.pair || "")
                      .replace("{fee}", formatFeePercent(row.feePercent, locale))
                  : row.side === "createPool"
                    ? (t.createdPoolActivity || "Created {pair} pool").replace("{pair}", row.pair || "")
                    : row.side === "addLp"
                      ? (t.addedLpActivity || "Added LP to {pair}").replace("{pair}", row.pair || "")
                      : row.side === "removeLp"
                        ? (t.removedLpActivity || "Removed {amount} LP from {pair}")
                            .replace("{amount}", row.lp != null ? formatNumber(row.lp, locale, { maximumFractionDigits: 4 }) : "")
                            .replace("{pair}", row.pair || "")
                            .replace(/\s+/g, " ")
                            .trim()
                        : row.side === "trustline" || row.side === "removeTrustline"
                          ? (
                              row.side === "removeTrustline" || row.removed
                                ? t.removedTrustlineActivity || "Removed {asset} trustline"
                                : t.trustlineActivity || "Added {asset} trustline"
                            ).replace(
                              "{asset}",
                              displayTrustlinePair(row, view.pools) || row.pair || t.xio
                            )
                          : `${row.side === "sell" ? t.sell : t.buy} ${formatNumber(row.xio, locale)} XIO${
                              row.price ? ` @ ${formatQuotePerBase(row.price, locale, "XRP")}` : ""
                            }`}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
