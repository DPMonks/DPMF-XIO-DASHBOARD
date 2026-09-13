import {useEffect, useMemo, useRef, useState} from "react";
import {getPrices, getWalletAccount, getWalletBalances, getWalletLines} from "../api/indexer";
import {useWallet} from "../context/useWallet";
import {useI18n} from "../i18n/useI18n";
import {AMM_CREATE_DEFAULT_FEE, AMM_CREATE_MAX_FEE, RATIO_WARN_ABS_PCT, ammCreateTxjson, createPoolBlocker, createQuoteOptions, defaultCreateQuoteId, depositRatio, estimatedCreateLp, estimatedPoolValueXrp, existingPoolForQuote, hasAssetLine, hasXioLine, issuedBalance, preferWalletLines, ratioDeltaPct, resolveCreateQuote} from "../wallet/ammCreate";
import {liveWalletAddress} from "../wallet/walletStorage";
import {xioQuoteSpot, xioXrpSpot} from "../wallet/quoteMarker";
import {formatFeePercent, feeUnitsFromPercent} from "../wallet/ammVote";
import {formatToken, formatUsd, shortAddress} from "../utils/format";
import {detectQuoteUsd, normalizePriceBook} from "../utils/poolSplit";
import {WALLET_EVENTS, notifyWalletRefresh, quoteTrustSetTxjson, sanitizeQtyInput} from "../xaman/tradeTx";
import {xioTrustSetTxjson} from "../constants/ledger";
import {useXamanPayload} from "../xaman/useXamanPayload";
import BrandSelect from "./BrandSelect";
import WalletModal from "./WalletModal";

function mergeWalletLines(balances, lines) {
  const raw = (balances && balances.raw) || {};
  return {
    ...(balances || {}),
    raw: {
      ...raw,
      lines: preferWalletLines(lines, raw),
    },
  };
}

async function loadCreatePoolAssets(account, extra = {}) {
  const [balances, lines, accountInfo] = await Promise.all([
    getWalletBalances(account).catch(() => ({})),
    getWalletLines(account, extra).catch(() => []),
    getWalletAccount(account).catch(() => ({})),
  ]);
  const drops = Number(accountInfo?.balance_drops);
  const liveXrp = Number.isFinite(drops) ? drops / 1_000_000 : null;
  return {
    ...mergeWalletLines(
      {
        ...balances,
        xrp: Number.isFinite(Number(balances.xrp)) && Number(balances.xrp) > 0 ? Number(balances.xrp) : liveXrp,
      },
      lines
    ),
    lines: Array.isArray(lines) ? lines : [],
  };
}

export default function CreatePoolCard({ pools = [], onJoinExisting, onCreated }) {
  const { t, locale } = useI18n();
  const { walletAddress, connectWallet } = useWallet();
  const { qr, mobileUrl, uuid, status, error, start, reset } = useXamanPayload();
  const [quoteId, setQuoteId] = useState(() => defaultCreateQuoteId(pools));
  const [xio, setXio] = useState("");
  const [quoteQty, setQuoteQty] = useState("");
  const [fee, setFee] = useState(AMM_CREATE_DEFAULT_FEE);
  const [feeHint, setFeeHint] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [balances, setBalances] = useState({});
  const [prices, setPrices] = useState({});
  const [formError, setFormError] = useState("");
  const quoteTouchedRef = useRef(false);

  const account = liveWalletAddress(walletAddress);
  const signedIn = Boolean(account);
  const options = useMemo(
    () => createQuoteOptions(pools, balances.raw, balances.lines),
    [pools, balances.raw, balances.lines]
  );
  const selected = options.find((row) => row.id === quoteId) || options[0];
  const existing = existingPoolForQuote(pools, selected?.ticker || selected?.id || quoteId);
  const quote = useMemo(
    () =>
      resolveCreateQuote(selected?.ticker || selected?.id || quoteId, {
        ticker: selected?.ticker,
        label: selected?.label,
        currency: selected?.currency,
        issuer: selected?.issuer,
        hex: selected?.hex,
        quote_issuer: selected?.issuer || existing?.quote_issuer,
        quote_hex: selected?.hex || existing?.quote_hex,
      }),
    [quoteId, selected, existing]
  );
  const quoteIsXrp = !quote.issuer || quote.currency === "XRP";
  const quoteTicker = selected?.ticker || quote.id || quoteId;
  const xioBal = Number(balances.xio);
  const xrpBal = Number(balances.xrp);
  const quoteBal = quoteIsXrp ? xrpBal : issuedBalance(balances.raw, quote);
  const book = normalizePriceBook(prices);
  const market = xioQuoteSpot({ quoteId: quoteTicker, prices: book });
  const xioXrp = xioXrpSpot(book);
  const quoteXrp = quoteIsXrp
    ? 1
    : (() => {
        const quoteUsd = detectQuoteUsd({ quoteId: quoteTicker, prices: book, allowImplied: true });
        const xrpUsd = Number(book.xrpUsd);
        return quoteUsd > 0 && xrpUsd > 0 ? quoteUsd / xrpUsd : 0;
      })();
  const ratio = depositRatio(xio, quoteQty);
  const delta = ratioDeltaPct(ratio, market);
  const lpOut = estimatedCreateLp(xio, quoteQty, quoteIsXrp);
  const poolXrp = estimatedPoolValueXrp({
    xioAmount: xio,
    quoteAmount: quoteQty,
    xioXrp,
    quoteXrp,
  });
  const xioUsd = Number(book.xioUsd) || 0;
  const quoteUsd = quoteIsXrp
    ? Number(book.xrpUsd) || 0
    : detectQuoteUsd({ quoteId: quoteTicker, prices: book, allowImplied: true }) || 0;
  const poolUsd =
    (Number(xio) > 0 && xioUsd > 0 ? Number(xio) * xioUsd : 0) +
    (Number(quoteQty) > 0 && quoteUsd > 0 ? Number(quoteQty) * quoteUsd : 0);
  const blocker = createPoolBlocker({
    signedIn,
    xio,
    quoteQty,
    quote,
    xioBalance: xioBal,
    quoteBalance: quoteBal,
    xrpBalance: xrpBal,
    raw: balances.raw,
    existing,
    fee,
  });
  const needXioLine = signedIn && !hasXioLine(balances.raw, xioBal);
  const needQuoteLine = signedIn && quote.issuer && !hasAssetLine(balances.raw, quote, quoteBal);

  useEffect(() => {
    if (quoteTouchedRef.current) return undefined;
    const next = defaultCreateQuoteId(pools, balances.raw, balances.lines);
    if (!next || next === quoteId) return undefined;
    const timer = window.setTimeout(() => setQuoteId(next), 0);
    return () => window.clearTimeout(timer);
  }, [pools, quoteId, balances.raw, balances.lines]);

  useEffect(() => {
    let cancelled = false;
    getPrices()
      .then((next) => {
        if (!cancelled) setPrices(normalizePriceBook(next || {}));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!account) {
      const timer = window.setTimeout(() => {
        setBalances({});
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    function pull(extra = {}) {
      loadCreatePoolAssets(account, extra)
        .then((next) => {
          if (!cancelled) setBalances(next || {});
        })
        .catch(() => {});
    }
    pull();
    function onRefresh() {
      pull({ fresh: true });
    }
    window.addEventListener("dpmf-wallet-refresh", onRefresh);
    window.addEventListener(WALLET_EVENTS.signedIn, onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener("dpmf-wallet-refresh", onRefresh);
      window.removeEventListener(WALLET_EVENTS.signedIn, onRefresh);
    };
  }, [account]);

  function askSignIn() {
    window.dispatchEvent(new Event(WALLET_EVENTS.needSignIn));
  }

  function signLine(txjson) {
    start({
      body: { txjson },
      trade: { action: "createPool", pair: `XIO/${quoteTicker}` },
      onSigned: (signedAccount) => {
        if (signedAccount) connectWallet(signedAccount);
        notifyWalletRefresh();
        if (account) {
          loadCreatePoolAssets(account)
            .then((next) => setBalances(next || {}))
            .catch(() => {});
        }
      },
      errorMessage: t.trustlineError,
    });
  }

  function submit() {
    setFormError("");
    if (!signedIn) {
      askSignIn();
      return;
    }
    if (existing) {
      onJoinExisting?.({
        action: "addLp",
        pair: existing.pool || existing.pool_name || `XIO/${quoteTicker}`,
        quote_issuer: existing.quote_issuer || quote.issuer,
        quote_hex: existing.quote_hex || quote.hex,
      });
      return;
    }
    if (needXioLine) {
      signLine(xioTrustSetTxjson(account));
      return;
    }
    if (needQuoteLine) {
      signLine(quoteTrustSetTxjson(account, { ...quote, currency: quote.hex || quote.currency }));
      return;
    }
    if (blocker === "amount") {
      setFormError(t.createPoolNeedAmount);
      return;
    }
    if (blocker === "xio-balance") {
      setFormError((t.createPoolNeedBalance || "Not enough {asset} for this deposit.").replace("{asset}", "XIO"));
      return;
    }
    if (blocker === "quote-balance") {
      setFormError((t.createPoolNeedBalance || "Not enough {asset} for this deposit.").replace("{asset}", quote.label));
      return;
    }
    if (blocker === "reserve") {
      setFormError(t.createPoolNeedReserve);
      return;
    }
    if (blocker) {
      setFormError(t.createPoolNeedAmount);
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    start({
      body: {
        txjson: ammCreateTxjson({
          account,
          quote,
          xio,
          quoteQty,
          tradingFee: fee,
        }),
      },
      trade: { action: "createPool", pair: `XIO/${quoteTicker}` },
      onSigned: () => notifyWalletRefresh(),
      onExecuted: () => {
        notifyWalletRefresh();
        setConfirming(false);
        setXio("");
        setQuoteQty("");
        onCreated?.();
      },
      errorMessage: t.createPoolSignError || t.tradeSignError,
    });
  }

  const blockerCopy = {
    exists: t.createPoolExists,
    wallet: t.createPoolNeedWallet,
    "xio-line": t.createPoolNeedXioLine,
    "quote-line": t.createPoolNeedQuoteLine,
    reserve: t.createPoolNeedReserve,
  }[blocker];

  return (
    <section className="dashboard-card neon-card create-pool-card" id="create-pool">
      <div className="create-pool-head">
        <div>
          <h2 className="card-title">{t.createPoolTitle}</h2>
          <p className="create-pool-sub">
            {t.createPoolSubtitle} {t.createPoolTrustlinesOnly}
          </p>
        </div>
        <p className="create-pool-wallet">
          {signedIn ? shortAddress(account) : t.createPoolNeedWallet}
        </p>
      </div>

      <div className="create-pool-grid">
        <div className="create-pool-form">
          <div className="create-pool-pair-fields">
          <label className="trade-field">
            {t.createPoolPrimary}
            <input type="text" readOnly value={t.createPoolLocked} />
          </label>

          <label className="trade-field">
            {t.createPoolSecondary}
            <BrandSelect
              value={quoteId}
              options={options}
              onChange={(id) => {
                quoteTouchedRef.current = true;
                setQuoteId(id);
                setConfirming(false);
                setFormError("");
              }}
              ariaLabel={t.createPoolSecondary}
              searchable={options.length > 4}
              placeholder={t.searchPair || t.createPoolSecondary}
            />
          </label>
          </div>

          <div className="create-pool-pair-fields">
          <label className="trade-field">
            {t.createPoolXioAmount}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={xio}
              onChange={(event) => {
                const next = sanitizeQtyInput(event.target.value);
                if (next == null) return;
                setXio(next);
                setConfirming(false);
              }}
            />
            <span className="trade-field-usd">
              {(t.createPoolAvailable || "Available {amount} {asset}")
                .replace("{amount}", signedIn ? formatToken(Number.isFinite(xioBal) ? xioBal : 0, locale, 6) : "—")
                .replace("{asset}", "XIO")}
            </span>
          </label>

          <label className="trade-field">
            {(t.createPoolQuoteAmount || "{asset} amount").replace("{asset}", quote.label)}
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={quoteQty}
              onChange={(event) => {
                const next = sanitizeQtyInput(event.target.value);
                if (next == null) return;
                setQuoteQty(next);
                setConfirming(false);
              }}
            />
            <span className="trade-field-usd">
              {(t.createPoolAvailable || "Available {amount} {asset}")
                .replace(
                  "{amount}",
                  signedIn ? formatToken(Number.isFinite(Number(quoteBal)) ? Number(quoteBal) : 0, locale, 6) : "—"
                )
                .replace("{asset}", quote.label)}
            </span>
          </label>
          </div>

          <div className="create-pool-ratio">
            <span>{t.createPoolRatio}</span>
            <b>
              {ratio > 0
                ? `${formatToken(ratio, locale, 8)} ${quote.label} / XIO`
                : "—"}
            </b>
            {market > 0 ? (
              <small>
                {(t.createPoolRatioHint || "{deposit} {quote} per XIO · market {market}")
                  .replace("{deposit}", ratio > 0 ? formatToken(ratio, locale, 8) : "—")
                  .replace("{quote}", quote.label)
                  .replace("{market}", formatToken(market, locale, 8))}
              </small>
            ) : null}
            {delta != null && Math.abs(delta) >= RATIO_WARN_ABS_PCT ? (
              <p className="create-pool-warn">{t.createPoolRatioWarn}</p>
            ) : null}
          </div>

          <div className="create-pool-fee">
            <div className="governance-vote-head">
              <label htmlFor="create-pool-fee">
                {t.createPoolFee}
                <b>{formatFeePercent(fee, locale)}</b>
              </label>
              <button
                type="button"
                className="governance-tip"
                title={t.createPoolFeeHint}
                onClick={() => setFeeHint((open) => !open)}
              >
                i
              </button>
            </div>
            {feeHint ? <p className="governance-tip-copy">{t.createPoolFeeHint}</p> : null}
            <input
              id="create-pool-fee"
              type="range"
              min="0"
              max={AMM_CREATE_MAX_FEE}
              step="0.001"
              value={fee}
              onChange={(event) => {
                setFee(Number(event.target.value));
                setConfirming(false);
              }}
            />
            <p className="governance-units">{feeUnitsFromPercent(fee)} / 1000</p>
          </div>
        </div>

        <aside className="create-pool-preview">
          <h3>{t.createPoolPreview}</h3>
          <dl className="trade-summary">
            <div>
              <dt>{t.createPoolPair}</dt>
              <dd>XIO / {quote.label}</dd>
            </div>
            <div>
              <dt>{t.createPoolDeposit}</dt>
              <dd>
                <span>
                  {formatToken(Number(xio) || 0, locale, 6)} XIO
                </span>
                <span>
                  {formatToken(Number(quoteQty) || 0, locale, 6)} {quote.label}
                </span>
              </dd>
            </div>
            <div>
              <dt>{t.createPoolInitialFee}</dt>
              <dd>{formatFeePercent(fee, locale)}</dd>
            </div>
            <div>
              <dt>{t.createPoolEstLp}</dt>
              <dd>{lpOut > 0 ? formatToken(lpOut, locale, 6) : "—"}</dd>
            </div>
            <div>
              <dt>{t.createPoolEstValue}</dt>
              <dd>
                {poolXrp > 0 ? `${formatToken(poolXrp, locale, 4)} XRP` : "—"}
                {poolUsd > 0 ? <span>{formatUsd(poolUsd, locale)}</span> : null}
              </dd>
            </div>
            <div>
              <dt>{t.createPoolAmmAddress}</dt>
              <dd>{t.createPoolAmmPending}</dd>
            </div>
          </dl>

          {signedIn && options.length <= 1 ? <p className="create-pool-note">{t.createPoolNoLines}</p> : null}
          {existing || blockerCopy ? <p className="create-pool-note">{blockerCopy || t.createPoolExists}</p> : null}
          {formError ? <p className="wallet-error">{formError}</p> : null}
          {error ? <p className="wallet-error">{error}</p> : null}

          {confirming && !existing ? (
            <div className="governance-confirm">
              <p>
                {(t.createPoolConfirm || "Sign AMMCreate for {pair}?")
                  .replace("{pair}", `XIO/${quote.label}`)}
              </p>
              <p>
                {(t.createPoolConfirmHint || "Deposit {xio} XIO + {quote} {asset} at {fee}.")
                  .replace("{xio}", formatToken(Number(xio) || 0, locale, 6))
                  .replace("{quote}", formatToken(Number(quoteQty) || 0, locale, 6))
                  .replace("{asset}", quote.label)
                  .replace("{fee}", formatFeePercent(fee, locale))}
              </p>
              <div className="governance-actions">
                <button type="button" className="connect-wallet-btn" onClick={submit}>
                  {t.tradeSign}
                </button>
                <button type="button" className="cancel-wallet-btn" onClick={() => setConfirming(false)}>
                  {t.cancel}
                </button>
              </div>
            </div>
          ) : (
            <div className="governance-actions">
              <button type="button" className="connect-wallet-btn" onClick={submit}>
                {!signedIn
                  ? t.connectWallet
                  : existing
                    ? t.createPoolJoin
                    : needXioLine
                      ? t.xioTrustline
                      : needQuoteLine
                        ? t.xioTrustline
                        : t.createPoolButton}
              </button>
            </div>
          )}
        </aside>
      </div>

      <WalletModal
        visible={status === "loading" || status === "waiting"}
        qrUrl={qr}
        mobileUrl={mobileUrl}
        uuid={uuid}
        status={status}
        preparingLabel={t.createPoolPreparing || t.preparingTrade}
        scanLabel={t.createPoolScan || t.scanTrade}
        onClose={reset}
      />
    </section>
  );
}
