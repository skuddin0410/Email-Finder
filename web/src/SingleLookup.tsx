import { FormEvent, useState } from 'react';
import { ApiError, findOne } from './api';
import ResultCard from './ResultCard';
import type { FindBody, FindResult } from './types';

export default function SingleLookup() {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<FindResult | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!url.trim() && !name.trim()) return setError('Enter a LinkedIn URL or a name.');
    if (!domain.trim()) return setError('Enter the company domain (for example acme.com).');
    const body: FindBody = { domain: domain.trim() };
    if (url.trim()) body.url = url.trim(); else body.name = name.trim();
    setLoading(true);
    setResult(null);
    try { setResult(await findOne(body)); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Something went wrong'); }
    finally { setLoading(false); }
  }

  return (
    <>
      <form onSubmit={submit} className="card" noValidate>
        <label>LinkedIn profile URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/in/jane-doe" inputMode="url" autoComplete="off" />
        </label>
        <p className="or">or</p>
        <label>Full name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoComplete="off" />
        </label>
        <label>Company domain
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" autoComplete="off" />
        </label>
        <button type="submit" className="primary" disabled={loading}>{loading ? 'Searching…' : 'Find email'}</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {result && <ResultCard result={result} />}
    </>
  );
}
