import { FindInput, InputError, Person } from './types.js';

const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'mba', 'cpa', 'pmp']);

/** Lowercase, strip diacritics, apostrophes and anything that is not a-z. */
function clean(token: string): string {
  return token.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

function fromTokens(tokens: string[]): { first: string; last: string } | null {
  const words = tokens
    .filter((t) => !TITLES.has(t.toLowerCase().replace(/\./g, '')))
    .map(clean)
    .filter(Boolean);
  const [first, ...rest] = words;
  if (!first) return null;
  return { first, last: rest.join('') };
}

function fromLinkedIn(raw: string): { first: string; last: string } {
  let u: URL;
  try { u = new URL(raw); } catch { throw new InputError('invalid_input', 'url is not a valid URL'); }
  const host = u.hostname.toLowerCase();
  const isLinkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com');
  const m = isLinkedIn ? /^\/in\/([^/]+)\/?/.exec(u.pathname) : null;
  if (!m?.[1]) throw new InputError('unparseable_url', 'Not a LinkedIn profile URL (expected linkedin.com/in/<name>)');
  let slug: string;
  try { slug = decodeURIComponent(m[1]); } catch { slug = m[1]; }
  // LinkedIn appends a random id (letters+digits); names never contain digits.
  const tokens = slug.split('-').filter((t) => !/\d/.test(t));
  const parsed = fromTokens(tokens);
  if (!parsed) throw new InputError('unparseable_url', 'Could not read a name from that LinkedIn URL');
  return parsed;
}

export function parseInput(input: FindInput): Person {
  const url = input.url?.trim();
  const name = input.name?.trim();
  let n: { first: string; last: string } | null = null;
  if (url) n = fromLinkedIn(url);
  else if (name) n = fromTokens(name.split(/\s+/));
  if (!n) throw new InputError('invalid_input', 'Provide a LinkedIn URL or a name');
  const person: Person = { first: n.first, last: n.last };
  if (input.domain?.trim()) person.domain = input.domain.trim();
  if (input.company?.trim()) person.companyName = input.company.trim();
  return person;
}
