import type { BulkResponse, FindBody, FindResult } from './types';

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function parse<T>(res: Response): Promise<T> {
  let data: unknown;
  try { data = await res.json(); } catch { throw new ApiError('bad_response', 'Unexpected server response'); }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export async function findOne(body: FindBody): Promise<FindResult> {
  let res: Response;
  try { res = await fetch('/api/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new ApiError('network', 'Could not reach the server'); }
  return parse<FindResult>(res);
}

export async function findBulk(file: File): Promise<BulkResponse> {
  const form = new FormData();
  form.append('file', file);
  let res: Response;
  try { res = await fetch('/api/find/bulk', { method: 'POST', body: form }); }
  catch { throw new ApiError('network', 'Could not reach the server'); }
  return parse<BulkResponse>(res);
}

const esc = (v: unknown) => {
  let s = v === undefined || v === null ? '' : String(v);
  let force = false;
  if (/^[=+\-@\t\r]/.test(s)) { s = `'${s}`; force = true; }
  return force || /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function resultsToCsv(rows: BulkResponse['rows']): string {
  const head = 'row,name,company,domain,url,best_email,status,confidence,reason,error';
  const lines = rows.map((r) => {
    const b = r.result?.results[0];
    return [r.row, r.input.name, r.input.company, r.input.domain, r.input.url, b?.email, b?.status, b?.confidence, b?.reason, r.error].map(esc).join(',');
  });
  return [head, ...lines].join('\n') + '\n';
}
