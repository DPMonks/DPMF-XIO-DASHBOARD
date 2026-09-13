import {lazy, Suspense, useCallback, useEffect, useRef, useState} from "react";
import "./App.css";

import ConnectWallet from "./components/ConnectWallet";
import XioTrustline from "./components/XioTrustline";
import {useI18n} from "./i18n/useI18n";
import TokenDetails from "./components/TokenDetails";
import SiteJump from "./components/SiteJump";
import ConnectedWallet from "./components/ConnectedWallet";
import Footer from "./components/Footer";
import Skeleton from "./components/Skeleton";
import DeckGate from "./components/DeckGate";
import {handshake} from "./api";
import {INDEXER_ORIGIN, getAmm, getTopHolders, getTopLp, getWalletLp} from "./api/indexer";
import {interfaceLinkState} from "./utils/interfaceLink";
import {XIO_TOTAL_SUPPLY} from "./constants/ledger";
import {useWallet} from "./context/useWallet";
import {liveWalletAddress} from "./wallet/walletStorage";
import {claimExecutedTrade} from "./xaman/claimSignIn";
import {clearXamanReturn, discardStalePendingTrade, peekPendingPayload, shouldAutoClaimPendingTrade} from "./xaman/payloadResume";
import {applySignedLpOwner, isLpPoolTrade, rememberSignedLpOverlay, signedLpAccount, tradePoolHint} from "./ammPools";
import {preferLiveOwnerRows} from "./todayOwners";
import {WALLET_EVENTS, executionBelongsToOpenTrade, gateUnsignedTrade, lpHeldForPair, normalizeTradeRequest} from "./xaman/tradeTx";

const TradingChart = lazy(() => import("./components/TradingChart"));
const ActivityChart = lazy(() => import("./components/ActivityChart"));
const TokenDetailsChart = lazy(() => import("./components/TokenDetailsChart"));
const OrderBook = lazy(() => import("./components/OrderBook"));
const XioSwapPanel = lazy(() => import("./components/XioSwapPanel"));
const RichList = lazy(() => import("./components/RichList"));
const AmmCard = lazy(() => import("./components/AmmCard"));
const CreatePoolCard = lazy(() => import("./components/CreatePoolCard"));
const VotingContainer = lazy(() => import("./components/governance/VotingContainer"));
const TradePanel = lazy(() => import("./components/TradePanel"));
const TradeExecuted = lazy(() => import("./components/TradeExecuted"));

export default function App() {
  const { t } = useI18n();
  const { walletAddress } = useWallet();
  const pendingTradeRef = useRef(null);
  const lpOverlayRef = useRef(null);
  const [lpFocusPair, setLpFocusPair] = useState(null);
  const [lpFocusAt, setLpFocusAt] = useState(0);
  const [holders, setHolders] = useState([]);
  const [holderFreshness, setHolderFreshness] = useState(null);
  const [holdersLoading, setHoldersLoading] = useState(true);
  const [lpHolders, setLpHolders] = useState([]);
  const [lpFreshness, setLpFreshness] = useState(null);
  const [lpLoading, setLpLoading] = useState(true);
  const [ammData, setAmmData] = useState([]);
  const [ammLoading, setAmmLoading] = useState(true);
  const [errors, setErrors] = useState({});
  const [link, setLink] = useState({ status: "connecting" });
  const [tradeAction, setTradeAction] = useState(null);

  const paintLp = useCallback((rows, meta) => {
    const overlay = lpOverlayRef.current;
    const incoming = Array.isArray(rows) ? rows : [];
    const applied = overlay
      ? applySignedLpOwner(incoming, overlay.detail, overlay.account)
      : incoming;
    setLpHolders((prev) => (overlay ? applied : preferLiveOwnerRows(prev, applied)));
    if (meta) setLpFreshness(meta);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const embedded = window.self !== window.top;
    document.documentElement.classList.toggle("is-embedded", embedded);
    return () => document.documentElement.classList.remove("is-embedded");
  }, []);

  useEffect(() => {
    let cancelled = false;

    function applyLink(hs, extra = {}) {
      if (cancelled) return;
      setLink({
        status: extra.status || (hs.ok ? "ok" : "fallback"),
        protocol: hs.protocol,
        path: hs.path,
        error: extra.error || hs.error,
        health: hs.health?.status,
        source: hs.source || hs.health?.source || hs.raw?.source,
        database: hs.database || hs.health?.database || hs.raw?.database,
        hint: extra.hint || hs.hint || hs.health?.hint || hs.raw?.hint,
        onV1: hs.xrpl?.onV1 ?? hs.health?.xrpl?.onV1,
      });
    }

    async function loadHolders() {
      try {
        const nextHolders = await getTopHolders((rows, meta) => {
          if (!cancelled) {
            setHolders(rows);
            if (meta) setHolderFreshness(meta);
            setHoldersLoading(false);
          }
        });
        if (!cancelled) {
          setHolders(nextHolders);
          setErrors((current) => ({ ...current, holders: undefined }));
        }
        return null;
      } catch (error) {
        if (!cancelled) setErrors((current) => ({ ...current, holders: error.message }));
        return error.message;
      } finally {
        if (!cancelled) setHoldersLoading(false);
      }
    }

    async function loadLp() {
      try {
        const nextLp = await getTopLp((rows, meta) => {
          if (!cancelled) {
            paintLp(rows, meta);
            setLpLoading(false);
          }
        });
        if (!cancelled) {
          paintLp(nextLp);
          setErrors((current) => ({ ...current, lp: undefined }));
        }
        return null;
      } catch (error) {
        if (!cancelled) setErrors((current) => ({ ...current, lp: error.message }));
        return error.message;
      } finally {
        if (!cancelled) setLpLoading(false);
      }
    }

    async function loadAmm() {
      try {
        const nextAmm = await getAmm();
        if (!cancelled) {
          setAmmData(nextAmm);
          setErrors((current) => ({ ...current, amm: undefined }));
        }
        return null;
      } catch (error) {
        if (!cancelled) setErrors((current) => ({ ...current, amm: error.message }));
        return error.message;
      } finally {
        if (!cancelled) setAmmLoading(false);
      }
    }

    async function load() {
      const hsPromise = handshake();
      hsPromise.then((hs) => applyLink(hs)).catch(() => {});

      const [holderErr, lpErr, ammErr] = await Promise.all([
        loadHolders(),
        loadLp(),
        loadAmm(),
      ]);
      if (cancelled) return;

      const hs = await hsPromise.catch(() => ({ ok: false }));
      if (holderErr && lpErr && ammErr && !hs.ok) {
        applyLink(hs, {
          status: "error",
          error: hs.error || holderErr,
          hint: hs.hint || hs.error || holderErr,
        });
      }
    }

    let intervalId = 0;
    let idleId = 0;
    function startLists() {
      if (cancelled) return;
      load().catch(() => {});
      intervalId = window.setInterval(() => {
        load().catch(() => {});
      }, 60000);
    }
    // Handshake already started above; delay heavy list fetches so first paint stays free.
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(startLists, { timeout: 900 });
    } else {
      idleId = window.setTimeout(startLists, 120);
    }
    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && typeof window.cancelIdleCallback === "function" && idleId) {
        window.cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId);
      }
      clearInterval(intervalId);
    };
  }, [paintLp]);

  const refreshLists = useCallback(() => {
    getAmm()
      .then((next) => setAmmData(Array.isArray(next) ? next : []))
      .catch(() => {});
    getTopHolders((rows, meta) => {
      setHolders(rows);
      if (meta) setHolderFreshness(meta);
    })
      .then((rows) => {
        if (rows) setHolders(rows);
      })
      .catch(() => {});
    getTopLp((rows, meta) => {
      paintLp(rows, meta);
    })
      .then((rows) => {
        if (rows) paintLp(rows);
      })
      .catch(() => {});
  }, [paintLp]);

  const openTrade = useCallback((detail) => {
    const live = liveWalletAddress(walletAddress);
    const gated = gateUnsignedTrade(detail, live);
    if (gated.action === "ignore") return;
    if (gated.action === "sign-in") {
      pendingTradeRef.current = gated.trade;
      window.dispatchEvent(new Event(WALLET_EVENTS.needSignIn));
      return;
    }
    pendingTradeRef.current = null;
    discardStalePendingTrade({ force: true });
    setTradeAction({ ...gated.trade, openId: Date.now() });
  }, [walletAddress]);

  useEffect(() => {
    function onOpen(event) {
      openTrade(event.detail);
    }
    function onSignedIn() {
      const pending = pendingTradeRef.current;
      pendingTradeRef.current = null;
      if (!pending) return;
      discardStalePendingTrade({ force: true });
      setTradeAction({ ...pending, openId: Date.now() });
    }
    function onSignInCancelled() {
      pendingTradeRef.current = null;
    }
    function onTradePending(event) {
      const detail = event?.detail || {};
      setTradeAction((current) => {
        if (!current) return current;
        return {
          ...current,
          activeUuid: detail.uuid || current.activeUuid || null,
          signMarker: detail.signMarker || current.signMarker || null,
        };
      });
    }
    function onTradeExecuted(event) {
      const detail = event?.detail || {};
      setTradeAction((current) => {
        if (!current) return null;
        if (!executionBelongsToOpenTrade(current, detail)) return current;
        if (current.action === "xioPlatformFee" && current.nextTrade) {
          return { ...normalizeTradeRequest(current.nextTrade), openId: Date.now() };
        }
        return null;
      });
      if (isLpPoolTrade(detail)) {
        const account = signedLpAccount(detail, liveWalletAddress(walletAddress));
        const pair = tradePoolHint(detail);
        setLpHolders((rows) => {
          const painted = rememberSignedLpOverlay(rows, detail, account);
          lpOverlayRef.current = painted.overlay;
          return painted.rows;
        });
        if (pair) {
          setLpFocusPair(pair);
          setLpFocusAt(Date.now());
        }
        if (account && pair) {
          getWalletLp(account, { fresh: true })
            .then((positions) => {
              const held = lpHeldForPair(positions, pair, pair.split("/")[1]);
              if (!(held > 0)) return;
              const nextDetail = { ...detail, lpHeld: held };
              lpOverlayRef.current = { detail: nextDetail, account };
              setLpHolders((rows) => applySignedLpOwner(rows, nextDetail, account));
            })
            .catch(() => {});
        }
      }
      refreshLists();
    }
    window.addEventListener("dpmf-open-trade", onOpen);
    window.addEventListener(WALLET_EVENTS.tradePending, onTradePending);
    window.addEventListener("dpmf-trade-executed", onTradeExecuted);
    window.addEventListener(WALLET_EVENTS.signedIn, onSignedIn);
    window.addEventListener(WALLET_EVENTS.signInCancelled, onSignInCancelled);
    return () => {
      window.removeEventListener("dpmf-open-trade", onOpen);
      window.removeEventListener(WALLET_EVENTS.tradePending, onTradePending);
      window.removeEventListener("dpmf-trade-executed", onTradeExecuted);
      window.removeEventListener(WALLET_EVENTS.signedIn, onSignedIn);
      window.removeEventListener(WALLET_EVENTS.signInCancelled, onSignInCancelled);
    };
  }, [openTrade, refreshLists, walletAddress]);

  useEffect(() => {
    let busy = false;
    async function claimPendingTrade() {
      if (busy || !shouldAutoClaimPendingTrade()) return;
      const record = peekPendingPayload();
      const uuid = record?.uuid;
      if (!uuid) return;
      const trade = normalizeTradeRequest(record.trade);
      if (trade) {
        setTradeAction((current) =>
          current || { ...trade, openId: Date.now(), resumeUuid: record.uuid, resumeTxjson: record.txjson || null }
        );
      }
      busy = true;
      try {
        const claimed = await claimExecutedTrade(uuid);
        if (claimed?.executed) clearXamanReturn();
      } finally {
        busy = false;
      }
    }
    const boot = window.setTimeout(() => {
      claimPendingTrade();
    }, 0);
    function wake() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      window.setTimeout(() => {
        claimPendingTrade();
      }, 0);
    }
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("focus", wake);
    return () => {
      clearTimeout(boot);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("focus", wake);
    };
  }, []);

  const linkState = interfaceLinkState(link, t);

  useEffect(() => {
    let idleId = 0;
    const warm = () => {
    };
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(warm, { timeout: 2500 });
      return () => window.cancelIdleCallback(idleId);
    }
    idleId = window.setTimeout(warm, 1200);
    return () => clearTimeout(idleId);
  }, []);

  return (
    <div className="dashboard-container">
      <div className="site-chrome">
        <header className="dashboard-header neon-border">
          <div className="header-bar">
            <div className="header-brand">
              <img src="/mark.png?v=2" alt="" className="header-mark" />
              <div className="header-brand-copy">
                <h1 className="dashboard-title">{t.title}</h1>
                <p className="dashboard-subtitle">{t.subtitle}</p>
              </div>
            </div>
            <div className="header-actions">
              <XioTrustline />
              <ConnectWallet />
            </div>
          </div>
        </header>
      </div>

      <SiteJump />

      <p className={`indexer-source is-${linkState.tone}`} title={INDEXER_ORIGIN}>
        <span className="handshake-dot" aria-hidden="true" />
        <span className="indexer-source-label">{linkState.label}</span>
      </p>

      <div className="dashboard-grid">
        <div className="wallet-token-row">
          <section className="dashboard-card neon-card" id="wallet">
            <h2 className="card-title">{t.connectedWallet}</h2>
            <ConnectedWallet />
          </section>
          <div className="token-details-stack">
            <section className="dashboard-card neon-card" id="details">
              <h2 className="card-title">{t.tokenDetails}</h2>
              <TokenDetails />
            </section>
            <section className="dashboard-card neon-card token-details-chart-card">
              <h2 className="card-title">{t.xioDetailsChart}</h2>
              <Suspense fallback={<Skeleton height={260} />}>
                <TokenDetailsChart />
              </Suspense>
            </section>
          </div>
        </div>

        <section className="dashboard-card neon-card" id="trading">
          <h2 className="card-title">{t.tradingChart}</h2>
          <DeckGate
            id="trading"
            ids={["trading", "swap", "orderbook"]}
            placeholderIds={["swap", "orderbook"]}
            minHeight={520}
            rootMargin="400px 0px"
          >
            <Suspense fallback={<Skeleton height={300} />}>
              <TradingChart />
            </Suspense>
            <Suspense fallback={<Skeleton height={180} />}>
              <XioSwapPanel />
            </Suspense>
            <div className="orderbook-wrap" id="orderbook">
              <h3 className="card-title orderbook-title">{t.orderbook}</h3>
              <Suspense fallback={<Skeleton height={240} />}>
                <OrderBook />
              </Suspense>
            </div>
          </DeckGate>
        </section>

        <section className="dashboard-card neon-card" id="activity">
          <h2 className="card-title">{t.activityChart}</h2>
          <DeckGate id="activity" minHeight={360}>
            <Suspense fallback={<Skeleton height={300} />}>
              <ActivityChart />
            </Suspense>
          </DeckGate>
        </section>

        <div className="lists-row">
          <section className="dashboard-card neon-card" id="holders">
            <h2 className="card-title">{t.topHolders}</h2>
            <DeckGate id="holders" minHeight={320}>
              <Suspense fallback={<Skeleton height={280} />}>
                <RichList
                  className="is-xio-owners"
                  rows={holders}
                  loading={holdersLoading}
                  error={errors.holders}
                  valueKey="balance"
                  unit="XIO"
                  shareTotal={XIO_TOTAL_SUPPLY}
                  emptyLabel={t.emptyHolders}
                  searchPlaceholder={t.searchHolders}
                  freshness={holderFreshness}
                />
              </Suspense>
            </DeckGate>
          </section>

          <section className="dashboard-card neon-card" id="lp-owners">
            <h2 className="card-title">{t.lpHolders}</h2>
            <DeckGate id="lp-owners" minHeight={320}>
              <Suspense fallback={<Skeleton height={280} />}>
                <RichList
                  className="is-lp-holders"
                  rows={lpHolders}
                  loading={lpLoading}
                  error={errors.lp}
                  valueKey="lp_balance"
                  unit="LP"
                  showPair
                  defaultPair="XIO/XRP"
                  focusPair={lpFocusPair}
                  focusAt={lpFocusAt}
                  pairOptions={ammData.map((row) => row.pool_name || row.pool).filter(Boolean)}
                  emptyLabel={t.emptyLp}
                  searchPlaceholder={t.searchLp}
                  freshness={lpFreshness}
                />
              </Suspense>
            </DeckGate>
          </section>
        </div>

        <DeckGate id="create-pool" placeholderIds={["create-pool"]} minHeight={280}>
          <Suspense fallback={<Skeleton height={240} />}>
            <CreatePoolCard pools={ammData} onJoinExisting={openTrade} onCreated={refreshLists} />
          </Suspense>
        </DeckGate>

        <section className="dashboard-card neon-card amm-pools-card" id="pools">
          <h2 className="card-title">{t.ammPools}</h2>
          <DeckGate id="pools" minHeight={320}>
            <Suspense fallback={<Skeleton height={280} />}>
              <AmmCard
                pools={ammData}
                loading={ammLoading}
                error={errors.amm}
                onAddLiquidity={(pool) =>
                  openTrade({
                    action: "addLp",
                    pair: pool.pool || pool.pool_name,
                    quote: pool.quote,
                    quote_issuer: pool.quote_issuer,
                    quote_hex: pool.quote_hex,
                    amm: pool.amm_account,
                    lp_currency: pool.lp_currency,
                  })
                }
                onRemoveLiquidity={(pool) =>
                  openTrade({
                    action: "removeLp",
                    pair: pool.pool || pool.pool_name,
                    quote: pool.quote,
                    quote_issuer: pool.quote_issuer,
                    quote_hex: pool.quote_hex,
                    amm: pool.amm_account,
                    lp_currency: pool.lp_currency,
                  })
                }
              />
            </Suspense>
          </DeckGate>
        </section>

        <section className="dashboard-card neon-card governance-card" id="governance">
          <h2 className="card-title">{t.poolGovernance}</h2>
          <DeckGate id="governance" minHeight={280}>
            <Suspense fallback={<Skeleton height={240} />}>
              <VotingContainer />
            </Suspense>
          </DeckGate>
        </section>

      </div>

      <Footer />
      {tradeAction ? (
        <Suspense fallback={null}>
          <TradePanel
            key={tradeAction.openId || `${tradeAction.action}-${tradeAction.quote}`}
            action={tradeAction.action}
            initialQuote={tradeAction.quote}
            initialAmount={tradeAction.amount}
            quoteExtra={tradeAction}
            initialPools={ammData}
            resumeUuid={tradeAction.resumeUuid}
            resumeTxjson={tradeAction.resumeTxjson}
            onClose={(next) => {
              if (next?.action) {
                setTradeAction({ ...normalizeTradeRequest(next), openId: Date.now() });
                return;
              }
              setTradeAction(null);
            }}
          />
        </Suspense>
      ) : null}
      <Suspense fallback={null}>
        <TradeExecuted />
      </Suspense>
      <Suspense fallback={null}>
      </Suspense>
    </div>
  );
}
