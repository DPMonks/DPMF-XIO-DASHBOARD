import {formatFeePercent} from "../../wallet/ammVote";

export default function GovernanceDataPanel({ data, locale, t }) {
  const rows = [
    { label: t.currentTradingFee, value: formatFeePercent(data?.tradingFeePct, locale) },
    { label: t.medianVotedFee, value: formatFeePercent(data?.medianFeePct, locale) },
    { label: t.weightedVotedFee, value: formatFeePercent(data?.weightedFeePct, locale) },
    { label: t.totalVotes, value: data?.voteCount != null ? String(data.voteCount) : "—" },
    {
      label: t.yourCurrentVote,
      value: data?.yourVote ? formatFeePercent(data.yourVote.feePercent, locale) : "—",
    },
    { label: t.votingPeriod, value: t.voteAppliesImmediately },
  ];
  return (
    <dl className="governance-metrics">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
