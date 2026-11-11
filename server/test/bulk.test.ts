import { describe, it, expect } from 'vitest';
import { parseBulkCsv, toResultsCsv } from '../src/bulk.js';

const buf = (s: string) => Buffer.from(s, 'utf8');

describe('parseBulkCsv', () => {
  it('parses url rows and name+domain rows', () => {
    const { rows, errors } = parseBulkCsv(buf('url,domain\nhttps://linkedin.com/in/jane-doe,acme.com\n'));
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ row: 2, input: { url: 'https://linkedin.com/in/jane-doe', domain: 'acme.com' } }]);
    const r2 = parseBulkCsv(buf('name,company,domain\nJane Doe,Acme,acme.com\n'));
    expect(r2.rows[0]!.input).toEqual({ name: 'Jane Doe', company: 'Acme', domain: 'acme.com' });
  });
  it('handles BOM, CRLF, quoted commas, blank rows and header case', () => {
    const csv = '﻿Name,Domain\r\n"Smith, Jr",acme.com\r\n\r\n,\r\nAna Lopez,acme.com\r\n';
    const { rows } = parseBulkCsv(buf(csv));
    expect(rows.map((r) => r.input.name)).toEqual(['Smith, Jr', 'Ana Lopez']);
    expect(rows.map((r) => r.row)).toEqual([2, 5]);
  });
  it('rejects missing recognised columns', () => {
    expect(() => parseBulkCsv(buf('foo,bar\n1,2\n'))).toThrowError(/column/i);
  });
  it('rejects more than 200 data rows', () => {
    const csv = 'name,domain\n' + Array.from({ length: 201 }, (_, i) => `P${i} X,acme.com`).join('\n');
    expect(() => parseBulkCsv(buf(csv))).toThrowError(/200/);
  });
  it('accepts exactly 200 rows', () => {
    const csv = 'name,domain\n' + Array.from({ length: 200 }, (_, i) => `Pa${i} Xb,acme.com`).join('\n');
    expect(parseBulkCsv(buf(csv)).rows).toHaveLength(200);
  });
  it('reports a malformed CSV as a 400 InputError, not a crash', () => {
    expect(() => parseBulkCsv(buf('name,domain\n"unterminated,acme.com\n'))).toThrowError();
    expect(() => parseBulkCsv(Buffer.from([0, 1, 2, 255, 254]))).toThrowError();
  });
  it('rows with neither url nor name become per-row errors', () => {
    const { rows, errors } = parseBulkCsv(buf('url,name,domain\n,,acme.com\nhttps://linkedin.com/in/a-b,,x.com\n'));
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([{ row: 2, message: expect.stringMatching(/url or name/i) }]);
  });
});

describe('toResultsCsv', () => {
  it('escapes quotes/commas and neutralises spreadsheet formulas', () => {
    const csv = toResultsCsv([
      { row: 2, input: { name: '=HYPERLINK("x")', domain: 'acme.com' }, error: 'bad, "input"' },
    ]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('row,name,company,domain,url,best_email,status,confidence,reason,error');
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[1]).toContain('"bad, ""input"""');
  });
});
