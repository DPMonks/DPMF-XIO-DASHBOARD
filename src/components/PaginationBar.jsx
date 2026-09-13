import {useI18n} from "../i18n/useI18n";

export default function PaginationBar({
  page,
  totalPages,
  onPage,
  disabled = false,
}) {
  const { t } = useI18n();
  const last = Math.max(1, Math.trunc(Number(totalPages)) || 1);
  const current = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), last);

  return (
    <nav className="pagination" aria-label={t.page}>
      <button
        type="button"
        className="pagination-btn"
        disabled={disabled || current <= 1}
        aria-label={t.prevPage}
        onClick={() => onPage(current - 1)}
      >
        ‹
      </button>
      <span>
        {t.page} {current} {t.of} {last}
      </span>
      <button
        type="button"
        className="pagination-btn"
        disabled={disabled || current >= last}
        aria-label={t.nextPage}
        onClick={() => onPage(current + 1)}
      >
        ›
      </button>
    </nav>
  );
}
