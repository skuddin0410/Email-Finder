import { FormEvent, useEffect, useState } from 'react';
import { ApiError, findBulk, resultsToCsv } from './api';
import { Badge } from './ResultCard';
import type { BulkRowOut } from './types';

export default function BulkUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<BulkRowOut[] | null>(null);
  const [href, setHref] = useState('');

  useEffect(() => () => { if (href) URL.revokeObjectURL(href); }, [href]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!file) return setError('Choose a CSV file first.');
    setLoading(true);
    setRows(null);
    try {
      const res = await findBulk(file);
      setRows(res.rows);
      setHref(URL.createObjectURL(new Blob([resultsToCsv(res.rows)], { type: 'text/csv' })));
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Something went wrong'); }
    finally { setLoading(false); }
  }

  return (
    <>
      <form onSubmit={submit} className="card">
        <p className="muted">CSV with a <code>url</code> or <code>name</code> column plus a <code>domain</code> column (LinkedIn URLs don't reveal the company). Up to 200 rows.</p>
        <label>CSV file
          <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button type="submit" className="primary" disabled={loading}>{loading ? 'Processing…' : 'Run bulk lookup'}</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {rows && (
        <section aria-label="Bulk results" className="card">
          <a className="button" href={href} download="email-finder-results.csv">Download results</a>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Row</th><th>Input</th><th>Best email</th><th>Status</th><th>Conf.</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const b = r.result?.results[0];
                  return (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.input.name ?? r.input.url ?? ''}</td>
                      {r.error ? <td colSpan={3} className="error">{r.error}</td> : (
                        <><td>{b?.email ?? ''}</td><td>{b && <Badge status={b.status} />}</td><td>{b?.confidence}</td></>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
