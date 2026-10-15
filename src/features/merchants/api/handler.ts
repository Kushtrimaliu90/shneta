import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { limit } from '@/lib/rate-limit';
import { clientIpFrom } from '@/lib/utils';
import { logger } from '@/lib/logger';
import type { Json } from '@/lib/supabase/database.types';
import { apiKeyPrefix, bearerFrom } from '@/features/merchants/api-keys';
import {
  execMerchantApi,
  type ExecResult,
  type MerchantApiAction,
} from '@/features/merchants/api/exec';
import { apiError, apiOk } from '@/features/merchants/api/respond';

/**
 * docs/18 §2 — what every merchant API route does, in order, so no route does it differently.
 *
 *   1. a bearer token that looks like one of ours, or 401 — before anything costs a query;
 *   2. a rate limit keyed on the token's visible prefix, or 429;
 *   3. for a write, a JSON body no larger than the cap and matching the schema, or 413 / 400;
 *   4. the action, through `merchant_api_exec`, mapped onto the envelope.
 *
 * Failed authentications are counted per IP separately, so a scanner cycling tokens is slowed
 * without a real merchant's quota being touched. Both limiters fail open (docs/02 §9): the
 * security boundary is the key check inside the database, not the counter in front of it.
 *
 * The pieces are exported on their own as well, for the one route whose flow is not
 * "one body, one action" — the photograph upload (`images.ts`).
 */

/** A 2000-row stock sheet is ~200 kB of JSON; past this it is not a stock update. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface Caller {
  token: string;
  /** The visible head of the key, for logs and the rate-limit bucket. Never the token. */
  prefix: string;
}

/** Step 1 and 2: who is calling, or the response that says they may not. */
export async function authenticate(request: NextRequest): Promise<Caller | NextResponse> {
  const token = bearerFrom(request.headers.get('authorization'));
  if (!token) {
    await limit('merchantApiAuth', clientIpFrom(request.headers));
    return apiError('unauthorized', 401);
  }

  const prefix = apiKeyPrefix(token);
  if (!(await limit('merchantApi', prefix))) {
    return apiError('rate_limited', 429);
  }

  return { token, prefix };
}

/** Step 3: a JSON body that fits and parses, or the response that says why not. */
export async function readJsonBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return { ok: false, response: apiError('too_large', 413) };

  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return { ok: false, response: apiError('too_large', 413) };
    raw = text.trim() === '' ? {} : JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: apiError('invalid_body', 400, [{ path: [], message: 'Body is not valid JSON.' }]),
    };
  }

  return parseWith(schema, raw);
}

/** The same, for a query string — `?status=assigned` — so a GET is validated like a POST. */
export function readQuery<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; response: NextResponse } {
  return parseWith(schema, Object.fromEntries(request.nextUrl.searchParams));
}

function parseWith<T>(
  schema: z.ZodType<T>,
  raw: unknown,
): { ok: true; data: T } | { ok: false; response: NextResponse } {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };

  /*
   * Zod's issues, trimmed to path and message. The path is what a merchant's developer needs —
   * `rows.17.price_cents` — and the message is Zod's own, which is fine for an API nobody reads
   * in Albanian; the API is for software, and the portal is for people.
   */
  const details = parsed.error.issues.slice(0, 50).map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
  }));
  return { ok: false, response: apiError('invalid_body', 400, details) };
}

/** Step 4, the tail: an `ExecResult` as HTTP. */
export async function respondTo(
  request: NextRequest,
  caller: Caller,
  action: MerchantApiAction,
  result: ExecResult,
): Promise<NextResponse> {
  if (result.kind === 'unauthorized') {
    await limit('merchantApiAuth', clientIpFrom(request.headers));
    return apiError('unauthorized', 401);
  }
  if (result.kind === 'error') return apiError(result.code, result.status, result.details);

  logger.info('merchant api call', { action, key: caller.prefix });
  return apiOk(result.data);
}

interface Options<TBody, TQuery> {
  action: MerchantApiAction;
  /** Present for a write. Its output is merged into what reaches the SQL as `p_payload`. */
  body?: z.ZodType<TBody>;
  /** Present for a filtered read. Merged the same way. */
  query?: z.ZodType<TQuery>;
  /** Route params and anything else the handler already knows — `{ id }` — merged last. */
  params?: Record<string, Json>;
  /** Runs after a successful action, with its data; a side effect whose failure must not fail the call. */
  after?: (data: Json) => Promise<void>;
}

export async function runMerchantApi<TBody extends Json, TQuery extends Json>(
  request: NextRequest,
  options: Options<TBody, TQuery>,
): Promise<NextResponse> {
  const caller = await authenticate(request);
  if (caller instanceof NextResponse) return caller;

  let payload: Record<string, Json> = {};

  if (options.query) {
    const query = readQuery(request, options.query);
    if (!query.ok) return query.response;
    payload = { ...payload, ...(query.data as Record<string, Json>) };
  }

  if (options.body) {
    const body = await readJsonBody(request, options.body);
    if (!body.ok) return body.response;
    payload = { ...payload, ...(body.data as Record<string, Json>) };
  }

  if (options.params) payload = { ...payload, ...options.params };

  const result = await execMerchantApi(caller.token, options.action, payload);

  if (result.kind === 'ok' && options.after) {
    await options.after(result.data).catch((cause: unknown) => {
      logger.error('merchant api after-hook failed', {
        action: options.action,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    });
  }

  return respondTo(request, caller, options.action, result);
}
