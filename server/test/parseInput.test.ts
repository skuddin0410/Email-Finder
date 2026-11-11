import { describe, it, expect } from 'vitest';
import { parseInput } from '../src/engine/parseInput.js';
import { InputError } from '../src/engine/types.js';

describe('parseInput — LinkedIn URLs', () => {
  const cases: [string, string, string][] = [
    ['https://www.linkedin.com/in/jane-doe-a1b2c3d4/', 'jane', 'doe'],
    ['https://linkedin.com/in/john-smith', 'john', 'smith'],
    ['https://ca.linkedin.com/in/jos%C3%A9-o%27brien-n%C3%BA%C3%B1ez-jr-12345/', 'jose', 'obriennunez'],
    ['https://www.linkedin.com/in/madonna', 'madonna', ''],
    ['https://www.linkedin.com/in/jane-doe?trk=abc#x', 'jane', 'doe'],
  ];
  it.each(cases)('%s', (url, first, last) => {
    const p = parseInput({ url });
    expect(p.first).toBe(first);
    expect(p.last).toBe(last);
  });

  it.each([
    'https://linkedin.com/company/acme',
    'https://linkedin.com/in/',
    'https://linkedin.com/feed',
    'https://example.com/in/jane-doe',
    'https://notlinkedin.com/in/jane-doe',
  ])('rejects non-profile URL %s with 422', (url) => {
    try { parseInput({ url }); throw new Error('no throw'); }
    catch (e) { expect(e).toBeInstanceOf(InputError); expect((e as InputError).status).toBe(422); expect((e as InputError).code).toBe('unparseable_url'); }
  });
});

describe('parseInput — typed names', () => {
  it('strips titles/suffixes and merges hyphenated first name', () => {
    const p = parseInput({ name: 'Dr. Mary-Ann Van Der Berg PhD', domain: 'acme.com' });
    expect(p).toMatchObject({ first: 'maryann', last: 'vanderberg', domain: 'acme.com' });
  });
  it('single name keeps company', () => {
    expect(parseInput({ name: '  Ana  ', company: 'Acme' })).toMatchObject({ first: 'ana', last: '', companyName: 'Acme' });
  });
  it('handles accents and apostrophes', () => {
    expect(parseInput({ name: "José O'Brien-Núñez Jr." })).toMatchObject({ first: 'jose', last: 'obriennunez' });
  });
  it('carries a raw domain through untouched for later normalization', () => {
    expect(parseInput({ url: 'https://linkedin.com/in/jane-doe', domain: 'Acme.com' }).domain).toBe('Acme.com');
  });
});

describe('parseInput — invalid input', () => {
  it.each([{}, { name: '' }, { name: '   ' }, { url: 'not a url' }, { name: '12345' }])('400 for %j', (input) => {
    try { parseInput(input); throw new Error('no throw'); }
    catch (e) { expect(e).toBeInstanceOf(InputError); expect((e as InputError).status).toBe(400); }
  });
});
