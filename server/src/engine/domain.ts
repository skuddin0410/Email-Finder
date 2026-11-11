const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Reduce a URL / email / hostname to a bare lowercase domain, or null if invalid. */
export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0] ?? '';
  const at = s.lastIndexOf('@');
  if (at >= 0) s = s.slice(at + 1);
  s = s.replace(/:\d+$/, '').replace(/\.$/, '').replace(/^www\./, '');
  if (!s || s.length > 253) return null;
  const labels = s.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1]!)) return null;
  return s;
}
