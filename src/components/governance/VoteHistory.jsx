import {assetVoteStatus, formatFeePercent, formatVoteWeight} from "../../wallet/ammVote";
import {formatDay, shortAddress} from "../../utils/format";

function HistoryTable({ title, empty, children }) {
  return (
    <section className="governance-history">
      <h3>{title}</h3>
      {children || <p className="governance-empty">{empty}</p>}
    </section>
  );
}

export default function VoteHistory({ rows, assetRows, walletAddress, locale, t }) {
  const yours = Array.isArray(rows) ? rows.slice(0, 8) : [];
  const assets = Array.isArray(assetRows) ? assetRows.slice(0, 16) : [];
  const you = String(walletAddress || "").trim().toLowerCase();

  return (
    <div className="governance-history-stack">
      <HistoryTable title={t.assetVoteHistory} empty={t.noAssetVoteHistory}>
        {assets.length ? (
          <div className="governance-history-scroll">
            <table>
              <thead>
                <tr>
                  <th className="is-date">{t.voteDate}</th>
                  <th>{t.voteWallet}</th>
                  <th>{t.pair}</th>
                  <th>{t.feeVoted}</th>
                  <th>{t.voteWeight}</th>
                  <th>{t.voteStatus}</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((row, index) => {
                  const mine = you && String(row.account || "").toLowerCase() === you;
                  const live = assetVoteStatus(row) === "active";
                  return (
                    <tr
                      key={`${row.account}-${row.pair}-${index}`}
                      className={mine ? "is-you" : undefined}
                    >
                      <td className="is-date">{formatDay(row.timestamp, locale)}</td>
                      <td title={row.account}>{shortAddress(row.account)}</td>
                      <td>{row.pair}</td>
                      <td>{formatFeePercent(row.feePercent, locale)}</td>
                      <td>{formatVoteWeight(row.weightPct, locale)}</td>
                      <td className={live ? "is-vote-on" : "is-vote-off"}>
                        {live ? t.voteActive : t.voteInactive || "Not Active"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </HistoryTable>
      <HistoryTable title={t.voteHistory} empty={t.noVoteHistory}>
        {yours.length ? (
          <div className="governance-history-scroll">
            <table>
              <thead>
                <tr>
                  <th className="is-date">{t.voteDate}</th>
                  <th>{t.pair}</th>
                  <th>{t.feeVoted}</th>
                  <th>{t.voteStatus}</th>
                </tr>
              </thead>
              <tbody>
                {yours.map((row, index) => (
                  <tr key={row.txid || `${row.pair}-${row.timestamp}-${index}`}>
                    <td className="is-date">{formatDay(row.timestamp, locale)}</td>
                    <td>{row.pair}</td>
                    <td>{formatFeePercent(row.feePercent, locale)}</td>
                    <td>{row.status === "replaced" ? t.voteReplaced : t.voteActive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </HistoryTable>
    </div>
  );
}
