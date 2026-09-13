export function changeDirection(previous, next) {
  if (previous == null || previous === "" || next == null || next === "") return null;
  const from = Number(previous);
  const to = Number(next);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to === from) return null;
  return to > from ? "up" : "down";
}
