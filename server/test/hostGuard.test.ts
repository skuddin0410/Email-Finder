import { describe, it, expect } from 'vitest';
import { isBlockedAddress, isBlockedHostname } from '../src/engine/hostGuard.js';

describe('isBlockedAddress', () => {
  it.each(['0.0.0.0', '10.0.0.1', '10.255.255.255', '100.64.0.1', '127.0.0.1', '127.9.9.9', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.168.0.1', '192.0.0.8', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', 'garbage'])('blocks %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(true));
  it.each(['8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '11.0.0.1', '100.63.0.1', '169.253.0.1'])('allows %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(false));
});
describe('isBlockedHostname', () => {
  it.each(['localhost', 'foo.localhost', 'metadata.google.internal', 'printer.local', 'box.lan', 'host.home.arpa', 'intranet', 'LOCALHOST'])('blocks %s', (h) =>
    expect(isBlockedHostname(h)).toBe(true));
  it.each(['mx.google.com', 'aspmx.l.google.com', 'mail.acme.co.uk'])('allows %s', (h) => expect(isBlockedHostname(h)).toBe(false));
});
