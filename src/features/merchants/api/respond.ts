import { NextResponse } from 'next/server';

/**
 * docs/18 §2 — the response envelope.
 *
 * Every answer is `{ ok: true, data }` or `{ ok: false, error, details? }`, with the HTTP status
 * carrying the same information, so a client can branch on either. `error` is a stable machine code
 * from the list in docs/18 §4, never a sentence: sentences get translated, reworded and matched with
 * regexes in somebody's integration.
 *
 * `no-store` on everything, including errors. A merchant's offer list cached by a corporate proxy
 * and served to the next merchant behind it is the kind of leak nobody finds for a year.
 */

export type ApiErrorCode =
  | 'unauthorized'
  | 'insufficient_scope'
  | 'rate_limited'
  | 'invalid_body'
  | 'too_large'
  | 'unsupported_media_type'
  | 'empty'
  | 'too_many_rows'
  | 'too_many_open_batches'
  | 'too_many_images'
  | 'too_many_webhooks'
  | 'batch_decided'
  | 'wrong_state'
  | 'not_found'
  | 'internal';

const HEADERS = { 'Cache-Control': 'private, no-store' } as const;

export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status, headers: HEADERS });
}

export function apiError(error: ApiErrorCode, status: number, details?: unknown): NextResponse {
  return NextResponse.json(
    details === undefined ? { ok: false, error } : { ok: false, error, details },
    { status, headers: HEADERS },
  );
}
