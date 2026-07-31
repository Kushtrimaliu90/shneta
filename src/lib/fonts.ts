import { Inter, Manrope, Space_Grotesk } from 'next/font/google';

/**
 * docs/04 §4 — self-hosted via next/font with `display: swap`, so there is no layout shift
 * and no third-party request at runtime (docs/09 §3). Subset to latin + latin-ext, which is
 * what Albanian ë/ç need.
 */

export const fontDisplay = Space_Grotesk({
  subsets: ['latin', 'latin-ext'],
  weight: ['500', '600'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

export const fontBody = Inter({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

export const fontUi = Manrope({
  subsets: ['latin', 'latin-ext'],
  weight: ['600'],
  variable: '--font-manrope',
  display: 'swap',
});

export const fontVariables = `${fontDisplay.variable} ${fontBody.variable} ${fontUi.variable}`;
