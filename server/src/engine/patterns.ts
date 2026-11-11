export interface Pattern { email: string; pattern: string; rank: number }

/** Common corporate email formats, most likely first. */
export function generatePatterns(first: string, last: string, domain: string): Pattern[] {
  const f = first[0] ?? '';
  const l = last[0] ?? '';
  const all: [string, string][] = last
    ? [
        ['first.last', `${first}.${last}`], ['first', first], ['flast', `${f}${last}`], ['firstl', `${first}${l}`],
        ['first_last', `${first}_${last}`], ['last.first', `${last}.${first}`], ['f.last', `${f}.${last}`], ['last', last],
        ['firstlast', `${first}${last}`], ['lastf', `${last}${f}`], ['first-last', `${first}-${last}`], ['lastfirst', `${last}${first}`],
      ]
    : [['first', first]];
  const seen = new Set<string>();
  const out: Pattern[] = [];
  for (const [pattern, local] of all) {
    if (!local || seen.has(local)) continue;
    seen.add(local);
    out.push({ email: `${local}@${domain}`, pattern, rank: out.length });
  }
  return out;
}
