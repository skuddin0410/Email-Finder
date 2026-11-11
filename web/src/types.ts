export type Status = 'valid' | 'risky' | 'unknown' | 'invalid';
export interface Candidate { email: string; pattern: string; status: Status; confidence: number; reason: string }
export interface FindResult {
  person: { first: string; last: string };
  domain: string;
  catchAll: 'catch_all' | 'not_catch_all' | 'unknown';
  verificationAvailable: boolean;
  results: Candidate[];
}
export interface FindBody { url?: string; name?: string; domain?: string }
export interface BulkRowOut { row: number; input: { url?: string; name?: string; company?: string; domain?: string }; result?: FindResult; error?: string }
export interface BulkResponse { rows: BulkRowOut[] }
