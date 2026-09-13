import {useEffect, useMemo, useState} from "react";
import {getAmm, getPoolGovernance, getWalletLp, getWalletVotes} from "../../api/indexer";
import {useWallet} from "../../context/useWallet";
import {useI18n} from "../../i18n/useI18n";
import {shortAddress} from "../../utils/format";
import {liveWalletAddress} from "../../wallet/walletStorage";
import {lpHeldForPair, resolveQuote, WALLET_EVENTS} from "../../xaman/tradeTx";
import {useXamanPayload} from "../../xaman/useXamanPayload";
import {ammVoteTxjson, assetVoteRowsFromSlots, feePercentFromUnits, knownGovernancePairs, mergeAssetVoteRows, normalizeVotePair, poolForVotePair, voteHistoryFromActivity} from "../../wallet/ammVote";
import WalletModal from "../WalletModal";
import GovernanceDataPanel from "./GovernanceDataPanel";
import PoolSelector from "./PoolSelector";
import VoteHistory from "./VoteHistory";
import VotePanel from "./VotePanel";

export default function VotingContainer() {
  const { t, locale } = useI18n();
  const { walletAddress } = useWallet();
  const signedAccount = liveWalletAddress(walletAddress);
  const { qr, mobileUrl, uuid, status, error, start, reset } = useXamanPayload();
  const [pools, setPools] = useState([]);
  const [lpRows, setLpRows] = useState([]);
  const [pair, setPair] = useState("XIO/XRP");
  const [gov, setGov] = useState(null);
  const [history, setHistory] = useState([]);
  const [assetHistory, setAssetHistory] = useState([]);
  const [fee, setFee] = useState(0.25);
  const [confirming, setConfirming] = useState(false);
  const [needLp, setNeedLp] = useState(false);

  const selectedPool = useMemo(() => poolForVotePair(pools, lpRows, pair), [pools, lpRows, pair]);
  const held = lpHeldForPair(lpRows, pair, pair.split("/")[1], {
    amm: selectedPool?.amm_account || selectedPool?.amm,
    lp_currency: selectedPool?.lp_currency,
  });
  const options = useMemo(() => {
    const names = knownGovernancePairs(pools, [...lpRows, ...history, { pair }]);
    return names.map((name) => ({ id: name, label: name }));
  }, [pools, lpRows, history, pair]);
  const eligible = held > 0 || Number(gov?.lpBalance) > 0 || Boolean(gov?.eligible);

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      const [nextPools, nextLp] = await Promise.all([
        getAmm().catch(() => []),
        walletAddress ? getWalletLp(walletAddress).catch(() => []) : [],
      ]);
      if (cancelled) return;
      setPools(Array.isArray(nextPools) ? nextPools : []);
      setLpRows(Array.isArray(nextLp) ? nextLp : []);
    }
    const startLoad = setTimeout(loadCatalog, 0);
    window.addEventListener("dpmf-wallet-refresh", loadCatalog);
    return () => {
      cancelled = true;
      clearTimeout(startLoad);
      window.removeEventListener("dpmf-wallet-refresh", loadCatalog);
    };
  }, [walletAddress]);

  useEffect(() => {
    let cancelled = false;
    async function loadGov() {
      const [nextGov, votes] = await Promise.all([
        getPoolGovernance(pair, walletAddress, {
          issuer: selectedPool?.quote_issuer,
          hex: selectedPool?.quote_hex,
          ammAccount: selectedPool?.amm_account || selectedPool?.amm,
          lpBalance: held,
        }).catch(() => null),
        walletAddress ? getWalletVotes(walletAddress).catch(() => []) : [],
      ]);
      if (cancelled) return;
      setGov(nextGov);
      setHistory(voteHistoryFromActivity(votes, nextGov?.voteSlots || []));
      const current = nextGov?.yourVote?.tradingFee ?? nextGov?.tradingFee;
      if (Number.isFinite(Number(current))) {
        setFee(feePercentFromUnits(current));
      }
    }
    const startLoad = setTimeout(loadGov, 0);
    function onRefresh() {
      loadGov();
    }
    window.addEventListener("dpmf-wallet-refresh", onRefresh);
    window.addEventListener("dpmf-trade-executed", onRefresh);
    return () => {
      cancelled = true;
      clearTimeout(startLoad);
      window.removeEventListener("dpmf-wallet-refresh", onRefresh);
      window.removeEventListener("dpmf-trade-executed", onRefresh);
    };
  }, [pair, walletAddress, selectedPool, held]);

  useEffect(() => {
    let cancelled = false;
    async function loadAssetVotes() {
      const names = knownGovernancePairs(pools, [...lpRows, { pair }]).slice(0, 8);
      const lists = await Promise.all(
        names.map(async (name) => {
          const pool = poolForVotePair(pools, lpRows, name);
          const next = await getPoolGovernance(name, "", {
            issuer: pool?.quote_issuer,
            hex: pool?.quote_hex,
            ammAccount: pool?.amm_account || pool?.amm,
          }).catch(() => null);
          return assetVoteRowsFromSlots(next?.voteSlots, name);
        })
      );
      if (!cancelled) setAssetHistory(mergeAssetVoteRows(...lists));
    }
    const startLoad = setTimeout(loadAssetVotes, 0);
    function onRefresh() {
      loadAssetVotes();
    }
    window.addEventListener("dpmf-wallet-refresh", onRefresh);
    window.addEventListener("dpmf-trade-executed", onRefresh);
    return () => {
      cancelled = true;
      clearTimeout(startLoad);
      window.removeEventListener("dpmf-wallet-refresh", onRefresh);
      window.removeEventListener("dpmf-trade-executed", onRefresh);
    };
  }, [pools, lpRows, pair]);

  function askConfirm() {
    if (!signedAccount) {
      window.dispatchEvent(new Event(WALLET_EVENTS.needSignIn));
      return;
    }
    if (!eligible) {
      setNeedLp(true);
      return;
    }
    setNeedLp(false);
    setConfirming(true);
  }

  function signVote() {
    const account = signedAccount;
    if (!account) {
      window.dispatchEvent(new Event(WALLET_EVENTS.needSignIn));
      return;
    }
    const quote = resolveQuote(pair.split("/")[1], {
      quote_issuer: selectedPool?.quote_issuer,
      quote_hex: selectedPool?.quote_hex,
    });
    start({
      body: {
        txjson: ammVoteTxjson({
          account,
          quote,
          tradingFee: fee,
        }),
      },
      trade: { action: "vote", pair, voteType: "trading_fee" },
      errorMessage: t.voteSignError,
      onExecuted: () => {
        setConfirming(false);
        reset();
      },
    });
  }

  return (
    <div className="governance-box">
      <header className="governance-head">
        <div>
          <p className="governance-wallet">
            {signedAccount ? shortAddress(signedAccount) : t.connectWalletHint}
          </p>
        </div>
        <p className={`governance-elig${eligible ? " is-yes" : " is-no"}`}>
          {eligible ? t.eligibleVoter : t.notEligibleVoter}
        </p>
      </header>

      <PoolSelector
        value={pair}
        options={options}
        onChange={(next) => {
          setPair(normalizeVotePair(next));
          setConfirming(false);
          setNeedLp(false);
        }}
        ariaLabel={t.votePool}
      />
      <GovernanceDataPanel data={gov} locale={locale} t={t} />
      <VotePanel
        fee={fee}
        onFee={setFee}
        eligible={eligible}
        needLp={needLp}
        signedIn={Boolean(signedAccount)}
        confirming={confirming}
        onAskConfirm={askConfirm}
        onCancelConfirm={() => setConfirming(false)}
        onSign={signVote}
        pair={pair}
        locale={locale}
        t={t}
      />
      <VoteHistory
        rows={history}
        assetRows={mergeAssetVoteRows(assetVoteRowsFromSlots(gov?.voteSlots, pair), assetHistory)}
        walletAddress={signedAccount}
        locale={locale}
        t={t}
      />
      {error ? <p className="wallet-error">{error}</p> : null}
      <WalletModal
        visible={status === "loading" || status === "waiting"}
        qrUrl={qr}
        mobileUrl={mobileUrl}
        uuid={uuid}
        status={status}
        preparingLabel={t.preparingVote}
        scanLabel={t.scanVote}
        onClose={reset}
      />
    </div>
  );
}
