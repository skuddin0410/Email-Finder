import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { resultsToCsv } from './api';
import type { FindResult } from './types';

const result = (over: Partial<FindResult> = {}): FindResult => ({
  person: { first: 'jane', last: 'doe' }, domain: 'acme.com', catchAll: 'not_catch_all', verificationAvailable: true,
  results: [
    { email: 'jane.doe@acme.com', pattern: 'first.last', status: 'valid', confidence: 99, reason: 'smtp_accepted' },
    { email: 'jane@acme.com', pattern: 'first', status: 'invalid', confidence: 0, reason: 'mailbox_rejected' },
  ],
  ...over,
});
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('single lookup', () => {
  it('shows the best email, status, confidence, and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    fetchMock.mockReturnValue(json(result()));
    render(<App />);
    await user.type(screen.getByLabelText(/linkedin profile url/i), 'https://www.linkedin.com/in/jane-doe');
    await user.type(screen.getByLabelText(/company domain/i), 'acme.com');
    await user.click(screen.getByRole('button', { name: /find email/i }));
    const card = await screen.findByRole('region', { name: /result/i });
    expect(within(card).getByText('jane.doe@acme.com')).toBeInTheDocument();
    expect(within(card).getAllByText(/valid/i).length).toBeGreaterThan(0);
    expect(within(card).getAllByText(/99/).length).toBeGreaterThan(0);
    await user.click(within(card).getByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith('jane.doe@acme.com');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ url: 'https://www.linkedin.com/in/jane-doe', domain: 'acme.com' });
  });
  it('warns on catch-all domains', async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(json(result({ catchAll: 'catch_all' })));
    render(<App />);
    await user.type(screen.getByLabelText(/full name/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/company domain/i), 'acme.com');
    await user.click(screen.getByRole('button', { name: /find email/i }));
    expect(await screen.findByText(/catch-all/i)).toBeInTheDocument();
  });
  it('shows a banner when verification is unavailable', async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(json(result({ verificationAvailable: false })));
    render(<App />);
    await user.type(screen.getByLabelText(/full name/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/company domain/i), 'acme.com');
    await user.click(screen.getByRole('button', { name: /find email/i }));
    expect(await screen.findByText(/verification unavailable/i)).toBeInTheDocument();
  });
  it('shows API errors in an alert', async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(json({ error: { code: 'unparseable_url', message: 'Not a LinkedIn profile URL' } }, 422));
    render(<App />);
    await user.type(screen.getByLabelText(/linkedin profile url/i), 'https://linkedin.com/company/x');
    await user.type(screen.getByLabelText(/company domain/i), 'acme.com');
    await user.click(screen.getByRole('button', { name: /find email/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a LinkedIn profile URL');
  });
  it('validates locally: needs a url or name, and a domain; no request sent', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /find email/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/linkedin url or a name/i);
    await user.type(screen.getByLabelText(/full name/i), 'Jane Doe');
    await user.click(screen.getByRole('button', { name: /find email/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/domain/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('disables submit while loading', async () => {
    const user = userEvent.setup();
    let release!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => { release = r; }));
    render(<App />);
    await user.type(screen.getByLabelText(/full name/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/company domain/i), 'acme.com');
    await user.click(screen.getByRole('button', { name: /find email/i }));
    expect(screen.getByRole('button', { name: /searching/i })).toBeDisabled();
    release(new Response(JSON.stringify(result()), { status: 200 }));
    await waitFor(() => expect(screen.getByRole('button', { name: /find email/i })).toBeEnabled());
  });
});

describe('bulk upload', () => {
  it('uploads a CSV and offers a results download', async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(json({ rows: [
      { row: 2, input: { name: 'Jane Doe', domain: 'acme.com' }, result: result() },
      { row: 3, input: {}, error: 'Row needs a url or name' },
    ] }));
    const createObjectURL = vi.fn((_b: Blob) => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /bulk/i }));
    await user.upload(screen.getByLabelText(/csv file/i), new File(['name,domain\nJane Doe,acme.com\n'], 'in.csv', { type: 'text/csv' }));
    await user.click(screen.getByRole('button', { name: /run bulk/i }));
    expect(await screen.findByText('jane.doe@acme.com')).toBeInTheDocument();
    expect(screen.getByText(/Row needs a url or name/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /download results/i });
    expect(link).toHaveAttribute('download', 'email-finder-results.csv');
    const blob = createObjectURL.mock.calls[0]![0];
    expect(await blob.text()).toContain('jane.doe@acme.com');
  });
  it('shows the server error for a bad file', async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(json({ error: { code: 'invalid_input', message: 'Too many rows: the limit is 200' } }, 400));
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /bulk/i }));
    await user.upload(screen.getByLabelText(/csv file/i), new File(['x'], 'in.csv'));
    await user.click(screen.getByRole('button', { name: /run bulk/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('limit is 200');
  });
});

describe('resultsToCsv', () => {
  it('neutralises formulas and quotes commas', () => {
    const csv = resultsToCsv([{ row: 2, input: { name: '=SUM(1)', domain: 'a.com' }, error: 'a, b' }]);
    expect(csv).toContain("'=SUM(1)");
    expect(csv).toContain('"a, b"');
  });
});
