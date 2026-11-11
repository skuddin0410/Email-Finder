import net from 'node:net';

/** True for any address we must never connect to: private, loopback, link-local, reserved, or anything not a plain public IPv4. */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIP(ip) !== 4) return true; // IPv6 and garbage are refused outright; probes only use A-record IPv4 addresses
  const [a, b, c] = ip.split('.').map(Number) as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  return false;
}

const INTERNAL_SUFFIXES = ['.localhost', '.internal', '.local', '.lan', '.localdomain', '.home.arpa', '.intranet', '.corp'];

export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return !h.includes('.') || INTERNAL_SUFFIXES.some((s) => h.endsWith(s));
}
