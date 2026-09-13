import {useEffect, useRef, useState} from "react";
import {pairParts} from "../utils/currency";
import {displayPoolSplit, formatPoolPct} from "../utils/poolSplit";
import {formatToken, formatWhen, shortAddress} from "../utils/format";
import {formatAmmFee} from "../wallet/composeWallet";
import {ammPoolName, applyLivePoolReserves, applyTradePoolReserves, applyTradePoolVolume, compactPoolAmount, looksLikeLpAsQuote, filterAmmPools, isLpPoolTrade, mergeAmmPoolLists, poolAssetTrustlineId, poolKey, poolQuoteTicker, poolSplitMeta, rememberPoolVolume, searchAmmAccount, searchPairHint, tradePoolHint, tradeXioVolume} from "../ammPools";
import {discoverLiveAmmPool, getLiveLpReserves, getWalletAccount, getWalletBalances, getWalletLines} from "../api/indexer";
import {issuedBalance} from "../wallet/ammCreate";
import {walletAvailableAmounts} from "../wallet/composeWallet";
import {assetTrustTxjson, lpTrustTxjson, poolQuote} from "../ammTrustActions";
import {useWallet} from "../context/useWallet";
import {QUOTE_ASSETS, notifyWalletRefresh, unusedXrpCoversLines} from "../xaman/tradeTx";
import {useXamanPayload} from "../xaman/useXamanPayload";
import {liveWalletAddress} from "../wallet/walletStorage";
import {useI18n} from "../i18n/useI18n";
import Skeleton from "./Skeleton";
import WalletButton from "./WalletButton";
import WalletModal from "./WalletModal";

function SplitBar({ asset, quote, xioPct, quotePct, lead, reserveXio, reserveQuote, lpSupply, t }) {
  const split = displayPoolSplit(xioPct, quotePct);
  const meta = poolSplitMeta({
    reserve_asset: reserveXio,
    reserve_currency: reserveQuote,
    lp_supply: lpSupply,
  });
  const ready = split.measured;
  const xioLead = lead === "xio" || split.xioPct >= split.quotePct;
  const xioShare = Math.max(split.xioPct, 0);
  const quoteShare = Math.max(split.quotePct, 0);
  const lpLine =
    meta.xioPerLp != null && meta.quotePerLp != null && meta.lpSupply != null
      ? (t.poolLpLine || "1 LP · {xio} {asset} + {quote} {quoteAsset} · {lp} LP")
          .replace("{xio}", compactPoolAmount(meta.xioPerLp))
          .replace("{asset}", asset)
          .replace("{quote}", compactPoolAmount(meta.quotePerLp))
          .replace("{quoteAsset}", quote)
          .replace("{lp}", compactPoolAmount(meta.lpSupply))
      : meta.lpSupply != null
        ? `LP ${compactPoolAmount(meta.lpSupply)}`
        : "";

  return (
    <div className={`pool-split ${ready ? (xioLead ? "is-xio-lead" : "is-quote-lead") : "is-pending"}`}>
      <div className="pool-split-labels">
        <span className={`pool-split-xio ${xioLead ? "is-lead" : ""}`}>
          <i className="pool-split-swatch is-xio" aria-hidden="true" />
          <span className="pool-split-pct">{formatPoolPct(split.xioPct)}%</span>
          <span className="pool-split-asset">{asset}</span>
          {meta.reserveXio != null ? (
            <span className="pool-split-amt">{compactPoolAmount(meta.reserveXio)}</span>
          ) : null}
        </span>
        <span className="pool-split-ratio">
          {meta.lpSupply != null
            ? `LP ${compactPoolAmount(meta.lpSupply)}`
            : `${formatPoolPct(split.xioPct)} / ${formatPoolPct(split.quotePct)}`}
        </span>
        <span className={`pool-split-quote ${!xioLead ? "is-lead" : ""}`}>
          {meta.reserveQuote != null ? (
            <span className="pool-split-amt">{compactPoolAmount(meta.reserveQuote)}</span>
          ) : null}
          <span className="pool-split-pct">{formatPoolPct(split.quotePct)}%</span>
          <span className="pool-split-asset">{quote}</span>
          <i className="pool-split-swatch is-quote" aria-hidden="true" />
        </span>
      </div>
      <div
        className={`pool-split-bar ${ready ? (xioLead ? "is-xio-lead" : "is-quote-lead") : "is-pending"}`}
        role="img"
        aria-label={`${formatPoolPct(split.xioPct)} percent ${asset} ${compactPoolAmount(meta.reserveXio)}, ${formatPoolPct(split.quotePct)} percent ${quote} ${compactPoolAmount(meta.reserveQuote)}, LP ${compactPoolAmount(meta.lpSupply)}`}
      >
        <span
          className="pool-split-bar-xio"
          style={{ flexGrow: xioShare, flexShrink: 0, flexBasis: 0 }}
        />
        <span
          className="pool-split-bar-quote"
          style={{ flexGrow: quoteShare, flexShrink: 0, flexBasis: 0 }}
        />
        <i className="pool-split-mid" style={{ left: `${xioShare}%` }} aria-hidden="true" />
      </div>
      <p className="pool-split-lp">{lpLine || "\u00a0"}</p>
    </div>
  );
}

export default function AmmCard({ pools, loading, error, onAddLiquidity, onRemoveLiquidity }) {
  const { t, locale } = useI18n();
  const { walletAddress, connectWallet } = useWallet();
  const { qr, mobileUrl, uuid, status, error: signError, start, reset } = useXamanPayload();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState([]);
  const [looking, setLooking] = useState(false);
  const [signKind, setSignKind] = useState("quote");
  const [signAsset, setSignAsset] = useState("XIO");
  const [lineError, setLineError] = useState("");
  const [liveByKey, setLiveByKey] = useState({});
  const [volumeByKey, setVolumeByKey] = useState({});
  const [walletHold, setWalletHold] = useState({ xio: 0, xrp: 0, raw: {} });
  const lookupGen = useRef(0);
  const lookupTimer = useRef(0);
  const liveTimer = useRef(0);
  const catalog = mergeAmmPoolLists(pools, found);
  const filtered = filterAmmPools(catalog, query);
  const visible = filtered.map((row) => {
    const key = poolKey(row);
    const live = applyLivePoolReserves(row, liveByKey[key]);
    const volume24h = rememberPoolVolume(key, live.volume24h ?? live.volume24hXio, volumeByKey[key]);
    return { ...live, volume24h, volume24hXio: volume24h, volumeUnit: "xio" };
  });

  function pullLive(pool, extra = {}) {
    if (!pool) return Promise.resolve(null);
    return getLiveLpReserves({
      pair: pool.pool || pool.pool_name,
      quote: poolQuoteTicker(pool),
      issuer: pool.quote_issuer,
      hex: pool.quote_hex,
      ammAccount: pool.amm_account,
      fresh: extra.fresh,
    })
      .then((live) => {
        if (!live || live.empty || live.reserve_source === "empty") return null;
        if (
          looksLikeLpAsQuote({
            reserveXio: live.reserve_xio ?? live.reserve_asset,
            reserveQuote: live.reserve_currency ?? live.reserve_quote,
            lpSupply: live.lp_supply,
            quote: live.quote || live.pair || pool.quote || pool.pool,
          })
        ) {
          return null;
        }
        const key = poolKey(pool);
        const stamped = {
          ...live,
          pair: live.pair || pool.pool || pool.pool_name,
          quote: live.quote || pool.quote || poolQuoteTicker(pool),
          reserve_source: live.reserve_source || "amm_info",
          at: Date.now(),
        };
        setLiveByKey((current) => {
          const prior = current[key];
          const baseline = prior?.baseline;
          // Keep a fresher signed trade overlay while amm_info still mirrors the pre-trade snapshot.
          if (
            prior?.reserve_source === "trade" &&
            baseline &&
            Number(prior.at) > 0 &&
            Date.now() - Number(prior.at) < 15_000 &&
            Number(stamped.lp_supply) === Number(baseline.lp_supply) &&
            Number(stamped.reserve_asset ?? stamped.reserve_xio) ===
              Number(baseline.reserve_asset ?? baseline.reserve_xio) &&
            Number(stamped.reserve_currency ?? stamped.reserve_quote) ===
              Number(baseline.reserve_currency ?? baseline.reserve_quote)
          ) {
            return current;
          }
          return { ...current, [key]: stamped };
        });
        return stamped;
      })
      .catch(() => null);
  }

  function refreshLive(targets, extra = {}) {
    const rows = (Array.isArray(targets) ? targets : []).filter(Boolean).slice(0, 8);
    window.clearTimeout(liveTimer.current);
    liveTimer.current = window.setTimeout(() => {
      rows.forEach((pool) => {
        void pullLive(pool, extra);
      });
    }, extra.fresh ? 220 : 40);
  }

  function pollLiveAfterTrade(targets) {
    const rows = (Array.isArray(targets) ? targets : []).filter(Boolean).slice(0, 8);
    const delays = [220, 700, 1600, 3200];
    delays.forEach((ms) => {
      window.setTimeout(() => {
        rows.forEach((pool) => {
          void pullLive(pool, { fresh: true });
        });
      }, ms);
    });
  }

  function applyTradeThenLive(detail) {
    const pair = tradePoolHint(detail);
    const rows = filterAmmPools(mergeAmmPoolLists(pools, found), query);
    const targets = pair ? rows.filter((row) => ammPoolName(row) === pair) : rows.slice(0, 6);
    const nextTargets = targets.length ? targets : rows.slice(0, 6);
    const beforeByKey = {};
    setLiveByKey((current) => {
      const next = { ...current };
      for (const row of nextTargets) {
        const key = poolKey(row);
        const shown = applyLivePoolReserves(row, current[key]);
        beforeByKey[key] = {
          reserve_xio: shown.reserve_asset ?? shown.reserve_xio,
          reserve_asset: shown.reserve_asset ?? shown.reserve_xio,
          reserve_currency: shown.reserve_currency,
          reserve_quote: shown.reserve_currency,
          lp_supply: shown.lp_supply,
          pair: shown.pool || shown.pool_name || pair,
          quote: shown.quote || poolQuoteTicker(shown),
          reserve_source: "trade",
          at: Date.now(),
        };
        const traded = applyTradePoolReserves(shown, detail);
        next[key] = {
          reserve_xio: traded.reserve_asset ?? traded.reserve_xio,
          reserve_asset: traded.reserve_asset ?? traded.reserve_xio,
          reserve_currency: traded.reserve_currency,
          reserve_quote: traded.reserve_currency,
          lp_supply: traded.lp_supply,
          pair: traded.pool || traded.pool_name || pair,
          quote: traded.quote || poolQuoteTicker(traded),
          xdx_pct: traded.xdx_pct,
          xio_pct: traded.xio_pct,
          quote_pct: traded.quote_pct,
          lead: traded.lead,
          reserve_source: traded.reserve_source || "trade",
          at: Date.now(),
          baseline: beforeByKey[key],
        };
      }
      return next;
    });
    pollLiveAfterTrade(nextTargets);
  }

  function recordTradeVolume(detail) {
    const add = tradeXioVolume(detail);
    if (!(add > 0)) return;
    const pair = tradePoolHint(detail);
    const rows = filterAmmPools(mergeAmmPoolLists(pools, found), query);
    const targets = pair ? rows.filter((row) => ammPoolName(row) === pair) : rows.slice(0, 6);
    setVolumeByKey((current) => {
      const next = { ...current };
      for (const row of targets) {
        const key = poolKey(row);
        const shown = applyTradePoolVolume(
          { ...row, volume24h: current[key] ?? row.volume24h ?? 0 },
          detail
        );
        next[key] = Number(shown.volume24h) || 0;
      }
      return next;
    });
  }
  const signing = status === "loading" || status === "waiting";
  const account = liveWalletAddress(walletAddress);

  useEffect(() => {
    let cancelled = false;
    async function loadLines() {
      if (!account) {
        setWalletHold({ xio: 0, xrp: 0, raw: {}, account: {} });
        return;
      }
      const [next, bals, nextAccount] = await Promise.all([
        getWalletLines(account, { fresh: true }).catch(() => []),
        getWalletBalances(account).catch(() => ({})),
        getWalletAccount(account).catch(() => ({})),
      ]);
      if (cancelled) return;
      setWalletHold({
        xio: Number(bals?.xio) || 0,
        xrp: Number(bals?.xrp) || 0,
        raw: { ...(bals?.raw || {}), lines: Array.isArray(next) ? next : bals?.raw?.lines || [] },
        account: nextAccount && typeof nextAccount === "object" ? nextAccount : {},
      });
    }
    loadLines();
    window.addEventListener("dpmf-wallet-refresh", loadLines);
    return () => {
      cancelled = true;
      window.removeEventListener("dpmf-wallet-refresh", loadLines);
    };
  }, [account]);

  function poolHaveCopy(pool) {
    if (!account) return "";
    const quote = poolQuote(pool);
    const quoteId = poolQuoteTicker(pool);
    const quoteAmt =
      quoteId === "XRP" ? Number(walletHold.xrp) || 0 : issuedBalance(walletHold.raw, quote);
    const xioAmt = Number(walletHold.xio) || 0;
    const have = t.poolHave || "Have {amount} {asset}";
    const parts = [
      have.replace("{amount}", formatToken(xioAmt, locale, 2)).replace("{asset}", "XIO"),
    ];
    if (quoteId && quoteId !== "XIO") {
      parts.push(
        have
          .replace("{amount}", formatToken(Number(quoteAmt) || 0, locale, quoteId === "XRP" ? 4 : 2))
          .replace("{asset}", quoteId)
      );
    }
    return parts.join(" · ");
  }

  function signTrustline(pool, kind) {
    const txjson = kind === "lp" ? lpTrustTxjson(pool, account) : assetTrustTxjson(pool, account);
    if (!txjson) {
      setLineError(kind === "lp" ? t.lpTrustlineError : t.trustlineError);
      return;
    }
    const quote = poolQuote(pool);
    const hold = walletAvailableAmounts({
      balances: walletHold,
      account: walletHold.account || {},
      lines: walletHold.raw?.lines,
      quote,
    });
    const cover = unusedXrpCoversLines({
      spendable: hold.xrp,
      total: Number(walletHold.xrp) > 0 ? Number(walletHold.xrp) : hold.xrp,
      account: walletHold.account || {},
      extraLines: 1,
    });
    if (!cover.ok) {
      const pair = String(pool?.pool || pool?.pool_name || quote.pair || `XIO/${quote.id || "XSQUAD"}`)
        .replace(/\s+/g, "")
        .toUpperCase();
      setLineError(
        (t.tradeNeedLineReserve || "")
          .replace("{pair}", pair)
          .replace("{amount}", formatToken(cover.need, locale, 4))
      );
      return;
    }
    setLineError("");
    setSignKind(kind);
    setSignAsset(kind === "lp" ? "LP" : poolAssetTrustlineId(pool));
    start({
      body: { txjson },
      onSigned: (signedAccount) => {
        if (signedAccount) connectWallet(signedAccount);
        notifyWalletRefresh();
      },
      errorMessage: kind === "lp" ? t.lpTrustlineError : t.trustlineError,
    });
  }

  async function lookup(nextQuery) {
    const ammAccount = searchAmmAccount(nextQuery);
    const pair = searchPairHint(nextQuery);
    const quote = pair.split("/")[1] || "";
    if ((!pair && !ammAccount) || filterAmmPools(catalog, nextQuery).length) return;
    const known = QUOTE_ASSETS.find((row) => row.id === quote);
    const gen = (lookupGen.current += 1);
    setLooking(true);
    const hit = await discoverLiveAmmPool(pair, {
      quote,
      issuer: known?.issuer,
      hex: known?.hex,
      ammAccount,
    }).catch(() => null);
    if (gen !== lookupGen.current) return;
    setLooking(false);
    if (!hit) return;
    setFound((current) => mergeAmmPoolLists(current, [hit]));
  }

  function onSearch(value) {
    setQuery(value);
    window.clearTimeout(lookupTimer.current);
    if (!value.trim() || filterAmmPools(catalog, value).length) {
      lookupGen.current += 1;
      setLooking(false);
      return;
    }
    lookupTimer.current = window.setTimeout(() => lookup(value), 320);
  }

  useEffect(() => {
    refreshLive(filterAmmPools(mergeAmmPoolLists(pools, found), query).slice(0, 8));
    // refreshLive reads the latest pullLive closure; pool identity is the dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- catalog rows
  }, [pools, found, query]);

  useEffect(() => {
    function onTrade(event) {
      const detail = event?.detail || {};
      if (isLpPoolTrade(detail)) applyTradeThenLive(detail);
      recordTradeVolume(detail);
    }
    window.addEventListener("dpmf-trade-executed", onTrade);
    return () => {
      window.removeEventListener("dpmf-trade-executed", onTrade);
      window.clearTimeout(liveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signed LP amounts
  }, [found, pools, query]);

  if (loading && !pools.length && !found.length) {
    return (
      <div className="pool-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={420} />
        ))}
      </div>
    );
  }

  if (error && !pools.length && !found.length) {
    return <p className="error-message">{error}</p>;
  }

  return (
    <div className="amm-pools">
      <label className="amm-pools-search">
        <span className="sr-only">{t.searchPair || "Search XIO / asset"}</span>
        <input
          type="search"
          className="orderbook-search"
          value={query}
          placeholder={t.searchPair || "Search XIO / asset"}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      {looking ? <p className="amm-pools-looking">{t.lookingForPool || "Looking up that XIO pool on the ledger…"}</p> : null}
      {!catalog.length && !query.trim() ? (
        <p className="empty-message">{t.emptyPools}</p>
      ) : !visible.length ? (
        <p className="empty-message">{t.noMatchingPools || "No live XIO pools match that search."}</p>
      ) : (
        <div className="pool-grid">
          {visible.map((pool, index) => {
        const { asset, quote } = pairParts(pool.pool);
        const quoteName = pool.quote || quote;
        return (
          <article
            key={pool.amm_account || `${pool.pool}-${index}`}
            className={`pool-card ${
              pool.lead === "quote" ? "is-quote-lead" : pool.xio_pct != null ? "is-xio-lead" : ""
            }`}
          >
            <header className="pool-card-head">
              <span className="pair-badge">{pool.pool}</span>
              <span className="pool-updated">
                {pool.updated ? `${t.updated} ${formatWhen(pool.updated, locale)}` : "\u00a0"}
              </span>
            </header>
            <SplitBar
              asset={asset}
              quote={quoteName}
              xioPct={pool.xio_pct}
              quotePct={pool.quote_pct}
              lead={pool.lead}
              reserveXio={pool.reserve_asset ?? pool.reserve_xio}
              reserveQuote={pool.reserve_currency}
              lpSupply={pool.lp_supply}
              t={t}
            />
            <dl className="pool-stats">
              <div>
                <dt>{t.ammAccount}</dt>
                <dd title={pool.amm_account || ""}>{pool.amm_account ? shortAddress(pool.amm_account) : "—"}</dd>
              </div>
              <div>
                <dt>
                  {t.reserve} {asset}
                </dt>
                <dd title={formatToken(pool.reserve_asset, locale)}>{compactPoolAmount(pool.reserve_asset)}</dd>
              </div>
              <div>
                <dt>
                  {t.reserve} {quoteName}
                </dt>
                <dd title={formatToken(pool.reserve_currency, locale)}>
                  {pool.reserve_currency != null ? compactPoolAmount(pool.reserve_currency) : "—"}
                </dd>
              </div>
              <div>
                <dt>{t.lp}</dt>
                <dd title={pool.lp_currency || ""}>{pool.lp_currency ? shortAddress(pool.lp_currency) : "—"}</dd>
              </div>
              <div>
                <dt>{t.lpSupply}</dt>
                <dd title={formatToken(pool.lp_supply, locale)}>
                  {pool.lp_supply != null ? compactPoolAmount(pool.lp_supply) : "—"}
                </dd>
              </div>
              <div>
                <dt>{t.fee}</dt>
                <dd>{formatAmmFee(pool.trading_fee, locale)}</dd>
              </div>
              <div className="is-volume-stat">
                <dt>{t.volume24h}</dt>
                <dd title={formatToken(pool.volume24h ?? 0, locale)}>
                  <span className="is-volume">{compactPoolAmount(pool.volume24h ?? 0)}</span>{" "}
                  <span className="pool-volume-unit">{t.xio}</span>
                </dd>
              </div>
            </dl>
            <div className="pool-card-actions">
              {account ? <p className="pool-have">{poolHaveCopy(pool)}</p> : null}
              {onAddLiquidity ? (
                <WalletButton
                  label={t.addLiquidity}
                  title={`${t.addLiquidity} ${pool.pool}`}
                  onClick={() => onAddLiquidity(pool)}
                />
              ) : null}
              {onRemoveLiquidity ? (
                <WalletButton
                  className="is-remove-lp"
                  label={t.removeLiquidity}
                  title={`${t.removeLiquidity} ${pool.pool}`}
                  onClick={() => onRemoveLiquidity(pool)}
                />
              ) : null}
              <WalletButton
                className="is-trustline"
                label={(t.quoteTrustline || "{asset} Trustline").replace("{asset}", poolAssetTrustlineId(pool))}
                title={(t.quoteTrustline || "{asset} Trustline").replace("{asset}", poolAssetTrustlineId(pool))}
                disabled={signing}
                onClick={() => signTrustline(pool, "quote")}
              />
              <WalletButton
                className="is-lp-trustline"
                label={t.lpTrustline}
                title={`${t.lpTrustline} ${pool.pool}`}
                disabled={signing}
                onClick={() => signTrustline(pool, "lp")}
              />
            </div>
          </article>
        );
          })}
        </div>
      )}
      {lineError || signError ? <p className="wallet-error">{lineError || signError}</p> : null}
      <WalletModal
        visible={signing}
        qrUrl={qr}
        mobileUrl={mobileUrl}
        uuid={uuid}
        status={status}
        preparingLabel={
          signKind === "lp"
            ? t.preparingLpTrustline
            : (t.preparingAssetTrustline || t.preparingTrustline || "Preparing {asset} trustline…").replace(
                "{asset}",
                signAsset
              )
        }
        scanLabel={
          signKind === "lp"
            ? t.scanLpTrustline
            : (t.scanAssetTrustline || t.scanTrustline || "Scan to add the {asset} trustline").replace(
                "{asset}",
                signAsset
              )
        }
        onClose={reset}
      />
    </div>
  );
}
