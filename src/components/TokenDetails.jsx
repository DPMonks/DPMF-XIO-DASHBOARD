import {useEffect, useRef, useState} from "react";
import {getTokenDetails} from "../api/indexer";
import {formatDay, formatNumber, formatUsd, formatUsdPrice, formatXrpPrice, shortAddress} from "../utils/format";
import {changeDirection} from "../utils/valueFlash";
import {useI18n} from "../i18n/useI18n";
import Skeleton from "./Skeleton";

function Detail({ label, value, hint, amount }) {
  const [flash, setFlash] = useState(null);
  const previous = useRef(undefined);

  useEffect(() => {
    const prior = previous.current;
    previous.current = amount;
    if (prior === undefined) return;
    const direction = changeDirection(prior, amount);
    if (!direction) return undefined;
    setFlash(direction);
    const id = setTimeout(() => setFlash(null), 1400);
    return () => clearTimeout(id);
  }, [amount]);

  return (
    <div className={`token-detail neon-card${flash ? ` is-flash-${flash}` : ""}`}>
      <span className="token-detail-label">{label}</span>
      <span className={`token-detail-value${flash ? ` is-${flash}` : ""}`}>
        {value ?? "—"}
      </span>
      {hint ? <span className="token-detail-hint">{hint}</span> : null}
    </div>
  );
}

function pick(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (value != null && value !== "") return value;
  }
  return null;
}

function amountOf(data, keys) {
  const value = Number(pick(data, keys));
  return Number.isFinite(value) ? value : null;
}

export default function TokenDetails() {
  const { t, locale } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const lastGood = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await getTokenDetails((partial) => {
          if (!cancelled) {
            lastGood.current = partial;
            setData(partial);
            setError(null);
          }
        });
        if (!cancelled) {
          lastGood.current = next;
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && !lastGood.current) setError(err.message);
      }
    }

    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data && !error) {
    return (
      <div className="token-details-grid">
        {Array.from({ length: 16 }, (_, i) => (
          <Skeleton key={i} height={96} />
        ))}
      </div>
    );
  }

  if (error && !data) {
    return <p className="error-message">{error}</p>;
  }

  const blackholed = pick(data, ["blackholed"]);
  const blackholedAt = pick(data, ["blackholed_at", "blackholedAt"]);
  const issuer = pick(data, ["issuer"]);
  const usdPrice = pick(data, ["recorded_price", "xioUsd"]);
  const xrpPrice = pick(data, ["xioPerXrp", "xio_per_xrp"]);
  const recordedHint = `${t.recordedPrice} ${formatUsdPrice(usdPrice, locale)}`;

  return (
    <div className="token-details-grid">
      <Detail label={t.tokenType} value={pick(data, ["tokenType", "token_type"])} />
      <Detail
        label={t.price}
        value={formatUsdPrice(usdPrice, locale)}
        amount={amountOf(data, ["recorded_price", "xioUsd"])}
      />
      <Detail
        label={t.xioPerXrp}
        value={formatXrpPrice(xrpPrice, locale)}
        amount={amountOf(data, ["xioPerXrp", "xio_per_xrp"])}
      />
      <Detail
        label={t.xrplMarketCap}
        value={formatUsd(pick(data, ["xrplMarketCap"]), locale)}
        amount={amountOf(data, ["xrplMarketCap"])}
        hint={recordedHint}
      />
      <Detail
        label={t.circulatingMarketCap}
        value={formatUsd(pick(data, ["circulatingMarketCap"]), locale)}
        amount={amountOf(data, ["circulatingMarketCap"])}
        hint={recordedHint}
      />
      <Detail
        label={t.ammMarketCap}
        value={formatUsd(pick(data, ["ammMarketCap", "tvl_usd", "tvl"]), locale)}
        amount={amountOf(data, ["ammMarketCap", "tvl_usd", "tvl"])}
        hint={recordedHint}
      />
      <Detail
        label={t.circulating}
        value={formatNumber(pick(data, ["circulating", "circulating_supply"]), locale)}
        amount={amountOf(data, ["circulating", "circulating_supply"])}
      />
      <Detail
        label={t.totalSupply}
        value={formatNumber(pick(data, ["totalSupply", "total_supply"]), locale)}
        amount={amountOf(data, ["totalSupply", "total_supply"])}
      />
      <Detail
        label={t.burnedSupply}
        value={formatNumber(pick(data, ["burnedSupply", "burned_supply", "issuer_locked"]), locale)}
        amount={amountOf(data, ["burnedSupply", "burned_supply", "issuer_locked"])}
      />
      <Detail
        label={t.holders}
        value={formatNumber(pick(data, ["holders", "holder_count"]), locale)}
        amount={amountOf(data, ["holders", "holder_count"])}
      />
      <Detail
        label={t.trustlines}
        value={formatNumber(pick(data, ["trustlines", "trustline_count"]), locale)}
        amount={amountOf(data, ["trustlines", "trustline_count"])}
      />
      <Detail
        label={t.lpHoldersCount}
        value={formatNumber(pick(data, ["lp_holder_count"]), locale)}
        amount={amountOf(data, ["lp_holder_count"])}
      />
      <Detail
        label={t.lpTrustlinesCount}
        value={formatNumber(pick(data, ["lp_trustline_count"]), locale)}
        amount={amountOf(data, ["lp_trustline_count"])}
      />
      <Detail
        label={t.lpSupply}
        value={formatNumber(pick(data, ["lp_supply"]), locale)}
        amount={amountOf(data, ["lp_supply"])}
      />
      <Detail label={t.issuerAccount} value={issuer ? shortAddress(issuer) : "—"} />
      <Detail
        label={t.blackholed}
        value={
          blackholed == null ? "—" : blackholed ? t.blackholedYes || `${t.yes}, ${t.fixed}` : t.no
        }
        hint={blackholed && blackholedAt ? formatDay(blackholedAt, locale) : null}
      />
    </div>
  );
}
