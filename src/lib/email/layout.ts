import type { Locale } from '@/lib/constants';

/**
 * The shared email shell from docs/08 §6 — logo, rule, content, footer.
 *
 * Extracted when the second template arrived. `sendOrderConfirmation` was written as one
 * self-contained string, which was right for one email; five lifecycle emails copying that
 * skeleton would mean five places to fix a broken table in Outlook.
 *
 * Still hand-written HTML, not react-email. Email clients need inline styles and table
 * layout, so a JSX renderer buys composition at the cost of a build step and a dependency —
 * worth it at a dozen templates sharing components, not at six sharing a wrapper.
 *
 * Colours are literal hex rather than tokens: `var()` does not resolve in most email clients,
 * and Gmail strips `<style>`. They mirror the palette in globals.css and must be updated
 * together — the values here are cream #FAF9F5, ink #1B1E1C, forest-900 #123227,
 * forest-800 #1C4636, ink-600 #565E59, ink-500 #6B746F, line #E6E8E4, forest-50 #F0F7F3.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ShellOptions {
  locale: Locale;
  heading: string;
  /** One or more paragraphs of lead copy, already escaped or known-safe. */
  intro: string;
  /** Pre-rendered HTML for the body — tables, callouts, whatever the template needs. */
  body?: string;
  /** Footer line, typically the "track your order" hint plus the store name. */
  footer: string;
}

export function emailShell({ locale, heading, intro, body = '', footer }: ShellOptions): string {
  return `<!doctype html>
<html lang="${locale}">
  <body style="margin:0;background:#FAF9F5;font-family:ui-sans-serif,system-ui,sans-serif;color:#1B1E1C">
    <div style="max-width:600px;margin:0 auto;padding:32px 20px">
      <p style="margin:0;font-size:20px;font-weight:600;color:#123227">BIOCODE</p>
      <hr style="border:none;border-top:3px solid #1C4636;margin:12px 0 28px" />

      <h1 style="margin:0;font-size:22px;color:#123227">${heading}</h1>
      <p style="margin:12px 0 0;color:#565E59;line-height:1.6">${intro}</p>

      ${body}

      <hr style="border:none;border-top:1px solid #E6E8E4;margin:32px 0 16px" />
      <p style="margin:0;font-size:12px;color:#6B746F;line-height:1.6">${footer}</p>
    </div>
  </body>
</html>`;
}

/** A labelled callout block — the COD amount, a tracking number, a refund total. */
export function calloutBlock(title: string, body: string): string {
  return `<div style="margin-top:28px;padding:16px;background:#F0F7F3;border-radius:12px">
      <p style="margin:0;font-weight:600;color:#123227">${title}</p>
      <p style="margin:6px 0 0;color:#565E59">${body}</p>
    </div>`;
}

/**
 * The plain-text alternative, built from the same parts rather than stripped from the HTML.
 *
 * `EmailMessage` requires it and spam filters weight a missing text part against you, but the
 * real reason to build it deliberately is that regex-stripping tags produces text littered
 * with table whitespace — which reads worse than no text part at all to anyone actually using
 * a text client.
 */
export function plainText(parts: {
  heading: string;
  intro: string;
  facts?: [string, string][];
  callout?: [string, string];
  footer: string;
}): string {
  const lines = [parts.heading, '', parts.intro];

  if (parts.facts?.length) {
    lines.push('');
    for (const [label, value] of parts.facts) lines.push(value ? `${label}: ${value}` : label);
  }

  if (parts.callout) {
    lines.push('', parts.callout[0], parts.callout[1]);
  }

  lines.push('', '—', parts.footer);
  return lines.join('\n');
}

/** A definition row for a small facts table (carrier, tracking, amount). */
export function factRow(label: string, value: string): string {
  return `<tr>
      <td style="padding:6px 0;color:#565E59">${label}</td>
      <td style="padding:6px 0;text-align:right;font-weight:600">${value}</td>
    </tr>`;
}

export function factTable(rows: string): string {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:20px">${rows}</table>`;
}
