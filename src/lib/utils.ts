import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn's class combiner. Safe on the client — this module must stay server-free. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * URL-safe slug. Albanian ë/ç fold to e/c so slugs stay ASCII (docs/08 §1, §4).
 * Slugs are immutable after publish (CLAUDE.md §10) — this only ever runs on create.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

/** docs/08 §2 — reading time is words / 200, rounded up, floored at 1. */
export function readingMinutes(markdown: string): number {
  const words = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>[\]()`~-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

/** Truncates on a word boundary, for SEO descriptions and card excerpts. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const cut = input.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Absolute URL against the configured origin. Canonicals and JSON-LD require absolute. */
export function absoluteUrl(path: string, origin: string): string {
  return new URL(path.startsWith('/') ? path : `/${path}`, origin).toString();
}

/** Type guard that keeps `Array.prototype.filter` from widening to `(T | null)[]`. */
export function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}

/**
 * Best-effort client IP for rate-limit keys (docs/02 §9). Vercel sets `x-forwarded-for`;
 * the left-most entry is the client. Falls back to a constant so the limiter still buckets.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || headers.get('x-real-ip') || 'unknown';
}

/** Deterministic, non-throwing JSON parse for jsonb columns and cookies. */
export function safeJsonParse<T = unknown>(input: string | null | undefined): T | null {
  if (!input) return null;
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}
