// Manual live check: npm run smoke -w server -- "Jane Doe" acme.com
// Uses the real DNS resolver and real SMTP (port 25 must be open outbound from this host).
import { loadConfig } from './config.js';
import { findEmail } from './engine/findEmail.js';

const [name, domain] = process.argv.slice(2);
if (!name || !domain) { console.error('usage: npm run smoke -w server -- "Jane Doe" acme.com'); process.exit(2); }
const result = await findEmail({ name, domain }, { config: loadConfig() });
console.log(JSON.stringify(result, null, 2));
if (!result.verificationAvailable) console.error('\nNOTE: verification unavailable (port 25 blocked or DNS failing); results are unverified guesses.');
