export function copyToClipboard(text) {
  if (!text) return Promise.resolve();
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.resolve();
}
