export type Status = 'valid' | 'risky' | 'unknown' | 'invalid';
export interface Person { first: string; last: string; domain?: string; companyName?: string }
export interface FindInput { url?: string; name?: string; company?: string; domain?: string }
export class InputError extends Error {
  constructor(
    public code: 'invalid_input' | 'unparseable_url',
    message: string,
    public status: 400 | 422 = code === 'unparseable_url' ? 422 : 400,
  ) { super(message); this.name = 'InputError'; }
}
