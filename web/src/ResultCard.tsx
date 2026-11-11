import { useState } from 'react';
import type { Candidate, FindResult } from './types';

export const label = (reason: string) => reason.replace(/_/g, ' ');

export function Badge({ status }: { status: Candidate['status'] }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

export default function ResultCard({ result }: { result: FindResult }) {
  const [copied, setCopied] = useState(false);
  const best = result.results[0];
  async function copy() {
    if (!best) return;
    try { await navigator.clipboard.writeText(best.email); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  }
  return (
    <section aria-label="Result" className="card">
      {!result.verificationAvailable && (
        <p className="banner warn">Verification unavailable: the mail server could not be reached, so these are unverified guesses ordered by how common each format is.</p>
      )}
      {result.catchAll === 'catch_all' && (
        <p className="banner warn">This domain is a catch-all: it accepts any address, so a specific mailbox can't be confirmed.</p>
      )}
      {best ? (
        <div className="best">
          <div>
            <div className="email">{best.email}</div>
            <div className="meta"><Badge status={best.status} /> <span>{best.confidence}% confidence</span> <span className="muted">· {label(best.reason)}</span></div>
          </div>
          <button type="button" onClick={copy} aria-label="Copy email">{copied ? 'Copied' : 'Copy'}</button>
        </div>
      ) : <p>No candidates.</p>}
      {result.results.length > 1 && (
        <details>
          <summary>Other candidates ({result.results.length - 1})</summary>
          <ul className="list">
            {result.results.slice(1).map((c) => (
              <li key={c.email}><code>{c.email}</code><Badge status={c.status} /><span className="muted">{c.confidence}</span></li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
