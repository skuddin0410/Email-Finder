import { parse } from 'csv-parse/sync';
import type { FindResult } from './engine/findEmail.js';
import { InputError, type FindInput } from './engine/types.js';

export const MAX_BULK_ROWS = 200;
export interface BulkRow { row: number; input: FindInput }
export interface BulkRowError { row: number; message: string }
export interface BulkOutcome { row: number; input: FindInput; result?: FindResult; error?: string }

const ALIASES: Record<keyof FindInput, string[]> = {
  url: ['url', 'linkedin', 'linkedin_url', 'linkedin url', 'profile', 'profile_url'],
  name: ['name', 'full_name', 'full name'],
  company: ['company', 'company_name', 'company name', 'organization'],
  domain: ['domain', 'website', 'company_domain', 'company domain'],
};

export function parseBulkCsv(buf: Buffer): { rows: BulkRow[]; errors: BulkRowError[] } {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { throw new InputError('invalid_input', 'File is not valid UTF-8 text'); }

  let headerMap: Partial<Record<keyof FindInput, string>> = {};
  let records: { record: Record<string, string>; info: { lines: number } }[];
  try {
    records = parse(text, {
      columns: (h: string[]) => {
        const norm = h.map((x) => x.trim().toLowerCase());
        for (const key of Object.keys(ALIASES) as (keyof FindInput)[]) {
          const hit = norm.find((n) => ALIASES[key].includes(n));
          if (hit) headerMap[key] = hit;
        }
        return norm;
      },
      bom: true, skip_empty_lines: true, relax_column_count: true, trim: true, info: true,
    });
  } catch (e) {
    throw new InputError('invalid_input', `Could not read CSV: ${(e as Error).message}`);
  }
  if (!headerMap.url && !headerMap.name)
    throw new InputError('invalid_input', 'CSV needs a "url" column or a "name" column (plus "domain" or "company")');

  const rows: BulkRow[] = [];
  const errors: BulkRowError[] = [];
  let nonEmpty = 0;
  for (const { record, info } of records) {
    const input: FindInput = {};
    for (const key of Object.keys(headerMap) as (keyof FindInput)[]) {
      const v = record[headerMap[key]!]?.trim();
      if (v) input[key] = v;
    }
    const anyValue = Object.values(record).some((v) => v && String(v).trim());
    if (!anyValue) continue;
    if (++nonEmpty > MAX_BULK_ROWS) throw new InputError('invalid_input', `Too many rows: the limit is ${MAX_BULK_ROWS}`);
    if (!input.url && !input.name) errors.push({ row: info.lines, message: 'Row needs a url or name' });
    else rows.push({ row: info.lines, input });
  }
  return { rows, errors };
}

const COLS = ['row', 'name', 'company', 'domain', 'url', 'best_email', 'status', 'confidence', 'reason', 'error'];
function esc(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v);
  let force = false;
  if (/^[=+\-@\t\r]/.test(s)) { s = `'${s}`; force = true; } // neutralise spreadsheet formula injection
  return force || /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toResultsCsv(rows: BulkOutcome[]): string {
  const lines = [COLS.join(',')];
  for (const r of rows) {
    const best = r.result?.results[0];
    lines.push([r.row, r.input.name, r.input.company, r.input.domain, r.input.url, best?.email, best?.status, best?.confidence, best?.reason, r.error].map(esc).join(','));
  }
  return lines.join('\n') + '\n';
}
