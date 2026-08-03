import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * docs/16 §8 — the money screens, for both sides.
 *
 * `merchant_payouts` and `merchant_ledger` both grant a merchant select on its own rows and staff select
 * on all of them, so these functions serve the portal and the admin panel from one definition. The
 * scoping is RLS, never a `where merchant_id = ?` this module has to remember — a query that forgot it
 * returns nothing rather than somebody else's statement.
 */

export type PayoutStatus = 'pending' | 'approved' | 'paid' | 'on_hold';

export interface PayoutRow {
  id: string;
  merchantId: string;
  merchantName: string | null;
  periodStart: string;
  periodEnd: string;
  grossCents: number;
  commissionCents: number;
  netCents: number;
  status: PayoutStatus;
  paidAt: string | null;
  reference: string | null;
  createdAt: string;
}

const COLUMNS = `id, merchant_id, period_start, period_end, gross_cents, commission_cents,
  net_cents, status, paid_at, reference, created_at, merchants ( display_name )`;

interface Raw {
  id: string;
  merchant_id: string;
  period_start: string;
  period_end: string;
  gross_cents: number;
  commission_cents: number;
  net_cents: number;
  status: PayoutStatus;
  paid_at: string | null;
  reference: string | null;
  created_at: string;
  merchants: { display_name: string } | null;
}

function toRow(row: Raw): PayoutRow {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    merchantName: row.merchants?.display_name ?? null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    grossCents: row.gross_cents,
    commissionCents: row.commission_cents,
    netCents: row.net_cents,
    status: row.status,
    paidAt: row.paid_at,
    reference: row.reference,
    createdAt: row.created_at,
  };
}

export async function listPayouts(status?: PayoutStatus): Promise<PayoutRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('merchant_payouts')
    .select(COLUMNS)
    // Most recent period first: the statement somebody is asking about is nearly always the last one.
    .order('period_end', { ascending: false })
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    logger.error('listPayouts failed', { cause: error.message });
    return [];
  }
  return ((data ?? []) as unknown as Raw[]).map(toRow);
}

export interface StatementLine {
  id: string;
  kind: string;
  amountCents: number;
  note: string | null;
  createdAt: string;
  orderNumber: string | null;
}

export interface Statement {
  payout: {
    id: string;
    periodStart: string;
    periodEnd: string;
    grossCents: number;
    commissionCents: number;
    netCents: number;
    status: PayoutStatus;
    paidAt: string | null;
    reference: string | null;
    createdAt: string;
  };
  merchant: {
    displayName: string;
    legalName: string;
    commissionPct: number;
    /** Last four digits only — a statement gets emailed and printed. */
    ibanLast4: string;
  };
  lines: StatementLine[];
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * One statement: the payout plus the ledger rows it settled.
 *
 * Through `merchant_statement`, which returns **null** for a payout the caller may not read — so a
 * merchant probing another's id gets the same answer as for one that does not exist.
 */
export async function getStatement(payoutId: string): Promise<Statement | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('merchant_statement', { p_payout_id: payoutId });

  if (error) {
    logger.error('getStatement failed', { cause: error.message });
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  const payload = data as Record<string, unknown>;
  const payout = (payload.payout ?? {}) as Record<string, unknown>;
  const merchant = (payload.merchant ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(payload.lines) ? (payload.lines as Record<string, unknown>[]) : [];

  const status = asText(payout.status);

  return {
    payout: {
      id: asText(payout.id),
      periodStart: asText(payout.period_start),
      periodEnd: asText(payout.period_end),
      grossCents: asNumber(payout.gross_cents),
      commissionCents: asNumber(payout.commission_cents),
      netCents: asNumber(payout.net_cents),
      status: (['pending', 'approved', 'paid', 'on_hold'] as string[]).includes(status)
        ? (status as PayoutStatus)
        : 'pending',
      paidAt: asNullableText(payout.paid_at),
      reference: asNullableText(payout.reference),
      createdAt: asText(payout.created_at),
    },
    merchant: {
      displayName: asText(merchant.display_name),
      legalName: asText(merchant.legal_name),
      commissionPct: asNumber(merchant.commission_pct),
      ibanLast4: asText(merchant.iban_last4),
    },
    lines: lines.map((line) => ({
      id: asText(line.id),
      kind: asText(line.kind),
      amountCents: asNumber(line.amount_cents),
      note: asNullableText(line.note),
      createdAt: asText(line.created_at),
      orderNumber: asNullableText(line.order_number),
    })),
  };
}

export interface Balance {
  balanceCents: number;
  salesCents: number;
  commissionCents: number;
  shippingCents: number;
  codCents: number;
  refundsCents: number;
  adjustmentsCents: number;
  paidOutCents: number;
  entryCount: number;
}

/**
 * What a merchant is owed right now.
 *
 * A plain sum over every ledger row, payouts included — they are negative, so a settled fortnight
 * leaves nothing behind. That is the property the signed single column buys, and it is why this needs no
 * "except the paid ones" clause anywhere.
 */
export async function merchantBalance(merchantId: string): Promise<Balance> {
  const empty: Balance = {
    balanceCents: 0,
    salesCents: 0,
    commissionCents: 0,
    shippingCents: 0,
    codCents: 0,
    refundsCents: 0,
    adjustmentsCents: 0,
    paidOutCents: 0,
    entryCount: 0,
  };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('merchant_balance', { p_merchant_id: merchantId });

  if (error) {
    logger.error('merchantBalance failed', { cause: error.message });
    return empty;
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    balanceCents: asNumber(row.balance_cents),
    salesCents: asNumber(row.sales_cents),
    commissionCents: asNumber(row.commission_cents),
    shippingCents: asNumber(row.shipping_cents),
    codCents: asNumber(row.cod_cents),
    refundsCents: asNumber(row.refunds_cents),
    adjustmentsCents: asNumber(row.adjustments_cents),
    paidOutCents: asNumber(row.paid_out_cents),
    entryCount: asNumber(row.entry_count),
  };
}

export interface LedgerEntry {
  id: string;
  kind: string;
  amountCents: number;
  note: string | null;
  createdAt: string;
}

/** The merchant's own ledger, newest first — the running account behind the balance. */
export async function listLedger(limit = 50): Promise<LedgerEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('merchant_ledger')
    .select('id, kind, amount_cents, note, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('listLedger failed', { cause: error.message });
    return [];
  }

  return ((data ?? []) as {
    id: string;
    kind: string;
    amount_cents: number;
    note: string | null;
    created_at: string;
  }[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    amountCents: row.amount_cents,
    note: row.note,
    createdAt: row.created_at,
  }));
}

/** Every approved merchant's balance, for the admin payout screen. Staff-scoped by RLS. */
export interface MerchantOwing {
  merchantId: string;
  merchantName: string;
  balanceCents: number;
}

export async function merchantsOwed(): Promise<MerchantOwing[]> {
  const supabase = await createClient();

  const { data: merchants, error } = await supabase
    .from('merchants')
    .select('id, display_name')
    .in('status', ['approved', 'suspended'])
    .order('display_name');

  if (error) {
    logger.error('merchantsOwed failed', { cause: error.message });
    return [];
  }

  const rows = (merchants ?? []) as { id: string; display_name: string }[];

  /*
   * One `merchant_balance` call per merchant, in parallel. A single grouped query would be one round
   * trip, but it would also be a second implementation of the balance — and the number on this screen
   * has to be the same number the statement and the payout are built from.
   */
  const balances = await Promise.all(rows.map((row) => merchantBalance(row.id)));

  return rows
    .map((row, index) => ({
      merchantId: row.id,
      merchantName: row.display_name,
      balanceCents: balances[index]?.balanceCents ?? 0,
    }))
    .filter((row) => row.balanceCents !== 0);
}
