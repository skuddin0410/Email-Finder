import { useState } from 'react';
import BulkUpload from './BulkUpload';
import SingleLookup from './SingleLookup';

export default function App() {
  const [tab, setTab] = useState<'single' | 'bulk'>('single');
  return (
    <main>
      <header>
        <h1>Email Finder</h1>
        <p className="sub">Find and verify a work email from a LinkedIn profile URL or a name and company domain.</p>
      </header>
      <div role="tablist" aria-label="Mode" className="tabs">
        <button role="tab" id="tab-single" aria-selected={tab === 'single'} aria-controls="panel-single" onClick={() => setTab('single')}>Single lookup</button>
        <button role="tab" id="tab-bulk" aria-selected={tab === 'bulk'} aria-controls="panel-bulk" onClick={() => setTab('bulk')}>Bulk CSV</button>
      </div>
      <div role="tabpanel" id="panel-single" aria-labelledby="tab-single" hidden={tab !== 'single'}><SingleLookup /></div>
      <div role="tabpanel" id="panel-bulk" aria-labelledby="tab-bulk" hidden={tab !== 'bulk'}><BulkUpload /></div>
      <footer>
        Verification is probabilistic: some mail servers accept every address or block checks, so not every result can be confirmed. Use for legitimate outreach only and respect GDPR / CAN-SPAM / CASL.
      </footer>
    </main>
  );
}
