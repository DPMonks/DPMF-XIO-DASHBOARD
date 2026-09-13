import {useEffect, useMemo, useRef, useState} from "react";
import {copyToClipboard} from "../utils/copy";
import {collectPairOptions, filterOrderbookPairs, normalizeOrderbookPair, sameOrderbookPair} from "../orderbook";
import {formatPercent, formatToken, formatWhen, shareOf, shortAddress} from "../utils/format";
import {LIST_PAGE_SIZE, pageSlice, resetScrollTop} from "../utils/pagination";
import {useI18n} from "../i18n/useI18n";
import PaginationBar from "./PaginationBar";
import Skeleton from "./Skeleton";

function PairSelect({ pairs, value, onChange, t }) {
  const boxRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => filterOrderbookPairs(pairs, query), [pairs, query]);
  const label = value === "all" ? t.allPairs : value;

  useEffect(() => {
    function onDoc(event) {
      if (!boxRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function select(next) {
    onChange(next);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className={`pair-select ${open ? "is-open" : ""}`} ref={boxRef}>
      <div className="pair-select-control">
        <input
          className="pair-select-input"
          type="search"
          value={open ? query : label}
          placeholder={t.searchPair}
          aria-label={t.searchPair}
          aria-expanded={open}
          aria-haspopup="listbox"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
            if (event.key === "Enter" && matches[0]) select(matches[0]);
          }}
        />
        <button
          type="button"
          className="pair-select-chevron"
          tabIndex={-1}
          aria-label={t.pair}
          onClick={() => setOpen((current) => !current)}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path
              d="M4.2 7.2h11.6L10 14.2 4.2 7.2z"
              fill="url(#pair-caret)"
              stroke="#c770ff"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <defs>
              <linearGradient id="pair-caret" x1="4" y1="7" x2="16" y2="15" gradientUnits="userSpaceOnUse">
                <stop stopColor="#00eaff" />
                <stop offset="1" stopColor="#c770ff" />
              </linearGradient>
            </defs>
          </svg>
        </button>
      </div>
      {open ? (
        <ul className="pair-select-list" role="listbox">
          {!query.trim() ? (
            <li>
              <button
                type="button"
                className={value === "all" ? "is-active" : ""}
                onClick={() => select("all")}
              >
                {t.allPairs}
              </button>
            </li>
          ) : null}
          {matches.map((pair) => (
            <li key={pair}>
              <button
                type="button"
                className={value === pair ? "is-active" : ""}
                onClick={() => select(pair)}
              >
                {pair}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TableSkeletons() {
  return (
    <div className="scroll-area">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} height={36} />
      ))}
    </div>
  );
}

export default function RichList({
  rows,
  loading,
  error,
  valueKey,
  emptyLabel,
  showPair = false,
  defaultPair = "XIO/XRP",
  focusPair = null,
  focusAt = 0,
  pairOptions = [],
  unit = "XIO",
  searchPlaceholder,
  freshness = null,
  shareTotal = null,
  className,
}) {
  const { t, locale } = useI18n();
  const tableWrapRef = useRef(null);
  const [query, setQuery] = useState("");
  const [pairFilter, setPairFilter] = useState(showPair ? defaultPair : "all");
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(null);
  const focusKey = showPair && focusPair ? `${normalizeOrderbookPair(focusPair)}@${focusAt || 0}` : "";
  const [appliedFocus, setAppliedFocus] = useState("");
  if (focusKey && focusKey !== appliedFocus) {
    setAppliedFocus(focusKey);
    setPairFilter(normalizeOrderbookPair(focusPair));
    setPage(1);
  }

  function goToPage(next) {
    setPage(next);
    resetScrollTop(tableWrapRef.current);
  }

  const pairs = useMemo(() => {
    const fromRows = rows.map((row) => row.pair).filter(Boolean);
    return collectPairOptions([...pairOptions, ...fromRows]);
  }, [rows, pairOptions]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (showPair && !sameOrderbookPair(row.pair, pairFilter)) return false;
      if (!needle) return true;
      return String(row.account || "").toLowerCase().includes(needle);
    });
  }, [rows, query, pairFilter, showPair]);

  const listedTotal = filtered.reduce(
    (sum, row) => sum + Number(row[valueKey] || 0),
    0
  );
  const total =
    Number.isFinite(Number(shareTotal)) && Number(shareTotal) > 0
      ? Number(shareTotal)
      : listedTotal;
  const { currentPage, totalPages, rows: pageRows } = pageSlice(filtered, page);
  const rankedRows = pageRows.map((row, index) => ({
    ...row,
    rank: showPair ? (currentPage - 1) * LIST_PAGE_SIZE + index + 1 : row.rank,
  }));

  const copy = async (address) => {
    await copyToClipboard(address);
    setCopied(address);
    setTimeout(() => setCopied((current) => (current === address ? null : current)), 1600);
  };

  const freshnessLine = freshness ? (
    <p
      className={`rich-freshness ${
        freshness.catching_up ? "is-catching-up" : "is-present"
      }`}
    >
      <span className="rich-freshness-dot" aria-hidden="true" />
      {freshness.catching_up
        ? `${t.todaySnapshotWaiting} ${
            freshness.as_of || freshness.snapshot_day
              ? formatWhen(freshness.as_of || freshness.snapshot_day, locale)
              : ""
          }`.trim()
        : freshness.as_of
          ? `${t.todaySnapshot} ${formatWhen(freshness.as_of, locale)}`
          : t.todaySnapshotLive}
    </p>
  ) : null;

  let body;
  if (loading && !rows.length) {
    body = <TableSkeletons />;
  } else if (error && !rows.length) {
    body = <p className="error-message">{error}</p>;
  } else if (!rows.length) {
    body = <p className="empty-message">{emptyLabel}</p>;
  } else if (!filtered.length) {
    body = <p className="empty-message">{showPair ? t.emptyLpPair : emptyLabel}</p>;
  } else {
    body = (
      <table className={`rich-table${showPair ? " has-pair" : ""}`}>
        <colgroup>
          <col className="col-rank" />
          <col className="col-address" />
          {showPair ? <col className="col-pair" /> : null}
          <col className="col-balance" />
          <col className="col-share" />
          <col className="col-copy" />
        </colgroup>
        <thead>
          <tr>
            <th className="col-rank">{t.rank}</th>
            <th className="col-address">{t.address}</th>
            {showPair && <th className="col-pair">{t.pair}</th>}
            <th className="col-balance col-num">{t.balance}</th>
            <th className="col-share col-num">{t.share}</th>
            <th className="col-copy" />
          </tr>
        </thead>
        <tbody>
          {rankedRows.map((row) => (
            <tr key={`${row.account}-${row.pair || "xio"}-${row.rank}`}>
              <td className="col-rank">{row.rank}</td>
              <td className="col-address">
                <button
                  type="button"
                  className="account-link"
                  title={row.account}
                  onClick={() => copy(row.account)}
                >
                  <span className="address-full">{row.account}</span>
                  <span className="address-short">{shortAddress(row.account)}</span>
                </button>
                {row.frozen && <span className="frozen-badge">{t.frozen}</span>}
              </td>
              {showPair && (
                <td className="col-pair">
                  <span className="pair-badge">
                    {normalizeOrderbookPair(row.pair || "XIO/XRP")}
                  </span>
                </td>
              )}
              <td className="col-num col-balance">
                <span className="rich-balance-qty">{formatToken(row[valueKey], locale, 8)}</span>
                {unit ? <span className="rich-balance-unit">{unit}</span> : null}
              </td>
              <td className="col-num col-share">
                {formatPercent(shareOf(row[valueKey], total), locale)}
              </td>
              <td className="col-copy">
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => copy(row.account)}
                >
                  {copied === row.account ? t.copied : t.copy}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className={["rich-list", className].filter(Boolean).join(" ")}>
      <div className="rich-list-toolbar">
        {showPair ? (
          <PairSelect
            pairs={pairs}
            value={pairFilter}
            onChange={(next) => {
              setPairFilter(next === "all" ? "all" : normalizeOrderbookPair(next));
              goToPage(1);
            }}
            t={t}
          />
        ) : null}
        <input
          className="rich-search"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            goToPage(1);
          }}
          placeholder={searchPlaceholder}
        />
        <p className="rich-meta">
          {t.showing} {filtered.length.toLocaleString(locale)} {t.addresses}
        </p>
      </div>
      {freshnessLine}

      <div className="rich-table-wrap" ref={tableWrapRef}>
        {body}
      </div>

      <PaginationBar
        page={currentPage}
        totalPages={totalPages}
        onPage={goToPage}
        disabled={loading && !rows.length}
      />
    </div>
  );
}
