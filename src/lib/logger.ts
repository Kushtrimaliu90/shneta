/**
 * docs/02 §10 — thin structured wrapper. `console.log` is banned by ESLint; everything
 * goes through here so production emits parsable JSON lines.
 */
type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const isProduction = process.env.NODE_ENV === 'production';

function emit(level: Level, message: string, fields?: Fields): void {
  const sink = level === 'error' ? console.error : console.warn;
  if (isProduction) {
    sink(JSON.stringify({ level, message, ts: new Date().toISOString(), ...fields }));
    return;
  }
  sink(`[${level}] ${message}`, fields ?? '');
}

export const logger = {
  info: (message: string, fields?: Fields) => emit('info', message, fields),
  warn: (message: string, fields?: Fields) => emit('warn', message, fields),
  error: (message: string, fields?: Fields) => emit('error', message, fields),
};

/**
 * Normalises an unknown thrown value for logging. Never returns the raw object —
 * server actions must not leak internals to the client (docs/02 §7).
 */
export function describeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return process.env.NODE_ENV === 'production'
      ? { message: error.message }
      : { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
