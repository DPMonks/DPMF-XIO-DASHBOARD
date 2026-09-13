export const LIST_PAGE_SIZE = 100;

export function pageCount(total, pageSize = LIST_PAGE_SIZE) {
  const n = Number(total);
  const size = Number(pageSize);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(size) || size <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(n / size));
}

export function currentPage(page, total, pageSize = LIST_PAGE_SIZE) {
  const last = pageCount(total, pageSize);
  const next = Math.trunc(Number(page)) || 1;
  return Math.min(Math.max(1, next), last);
}

export function pageSlice(rows, page, pageSize = LIST_PAGE_SIZE) {
  const list = Array.isArray(rows) ? rows : [];
  const size = Number(pageSize) > 0 ? Number(pageSize) : LIST_PAGE_SIZE;
  const current = currentPage(page, list.length, size);
  const start = (current - 1) * size;
  return {
    currentPage: current,
    totalPages: pageCount(list.length, size),
    rows: list.slice(start, start + size),
  };
}

export function resetScrollTop(node) {
  if (!node || typeof node.scrollTop !== "number") return false;
  node.scrollTop = 0;
  return true;
}

export function shouldFetchMoreRows(loaded, pageSize = LIST_PAGE_SIZE, knownTotal = null) {
  const have = Number(loaded) || 0;
  if (have <= 0) return false;
  const total = Number(knownTotal);
  if (Number.isFinite(total) && total > have) return true;
  return have >= Number(pageSize);
}
