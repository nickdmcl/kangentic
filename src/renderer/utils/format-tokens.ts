/**
 * Format a token count for compact display.
 * e.g. 850 → "850", 1200 → "1.2k", 45300 → "45.3k", 200000 → "200k", 1200000 → "1.2M"
 */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = (n / 1000).toFixed(1);
    return `${v.endsWith('.0') ? v.slice(0, -2) : v}k`;
  }
  const v = (n / 1_000_000).toFixed(1);
  return `${v.endsWith('.0') ? v.slice(0, -2) : v}M`;
}
