/**
 * Field-free LCP and CLS measurement, at the viewports that matter.
 *
 *   pnpm measure:vitals                      # the live site
 *   pnpm measure:vitals http://127.0.0.1:3000/
 *
 * Why not Lighthouse: Lighthouse throttles to a simulated mid-tier phone and reports a *score*, which
 * is the right tool for a budget and the wrong one for a before/after on one change. This reads the
 * same two entries the browser reports to `web-vitals` — `largest-contentful-paint` and `layout-shift`
 * — at three real viewport sizes, so the delta it prints is attributable to the diff rather than to
 * whatever else moved in the throttling model.
 *
 * CLS is collected for five seconds after load, which is long enough to catch a late-arriving image
 * resizing its own box — the failure this carousel could plausibly introduce.
 */
import { chromium, type Browser } from '@playwright/test';

const VIEWPORTS = [
  { name: '1440x900  desktop', width: 1440, height: 900 },
  { name: '1280x800  laptop', width: 1280, height: 800 },
  { name: '393x852   iPhone', width: 393, height: 852, mobile: true },
] as const;

interface Vitals {
  lcpMs: number;
  cls: number;
  lcpElement: string;
}

async function measure(browser: Browser, url: string, viewport: (typeof VIEWPORTS)[number]) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 'mobile' in viewport && viewport.mobile ? 3 : 1,
    isMobile: 'mobile' in viewport && viewport.mobile,
    hasTouch: 'mobile' in viewport && viewport.mobile,
  });
  const page = await context.newPage();

  /*
   * Registered before navigation, because both observers are buffered: an entry emitted during the
   * first paint is lost if the observer starts after it. `buffered: true` recovers what happened
   * before the callback attached, which is precisely the window LCP lives in.
   */
  await page.addInitScript(() => {
    const w = window as unknown as { __vitals: { lcp: number; cls: number; el: string } };
    w.__vitals = { lcp: 0, cls: 0, el: '' };

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { element?: Element; size?: number };
        w.__vitals.lcp = entry.startTime;
        w.__vitals.el = e.element
          ? `${e.element.tagName.toLowerCase()}${e.element.className ? `.${String(e.element.className).split(' ')[0]}` : ''}`
          : '(text)';
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Only shifts the user did not cause. A shift within 500ms of an interaction is expected.
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) w.__vitals.cls += shift.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  // Long enough for a late image to resize its box, which is the shift worth catching.
  await page.waitForTimeout(5_000);

  const raw = await page.evaluate(
    () => (window as unknown as { __vitals: { lcp: number; cls: number; el: string } }).__vitals,
  );
  const vitals: Vitals = { lcpMs: raw.lcp, cls: raw.cls, lcpElement: raw.el || '(none)' };
  const foldFits = await page.evaluate(() => {
    /*
     * "Does the hero fit above the fold" as a measurement rather than an opinion: the bottom edge of
     * the last thing the hero must show, against the viewport height.
     */
    const marks = ['[data-hero-cta]', '[data-trust-strip]'];
    for (const selector of marks) {
      const el = document.querySelector(selector);
      if (el) {
        const bottom = el.getBoundingClientRect().bottom;
        return { selector, bottom: Math.round(bottom), viewport: window.innerHeight };
      }
    }
    const h1 = document.querySelector('h1');
    return h1
      ? {
          selector: 'h1',
          bottom: Math.round(h1.getBoundingClientRect().bottom),
          viewport: window.innerHeight,
        }
      : null;
  });

  await context.close();
  return { vitals, foldFits };
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? 'https://biocode.fit/';
  const browser = await chromium.launch();

  console.log(`\nMeasuring ${url}\n`);
  console.log('viewport             LCP        CLS      LCP element        hero bottom / viewport');
  console.log('─'.repeat(92));

  for (const viewport of VIEWPORTS) {
    const { vitals, foldFits } = await measure(browser, url, viewport);
    const fold = foldFits
      ? `${foldFits.selector} ${foldFits.bottom} / ${foldFits.viewport}${foldFits.bottom <= foldFits.viewport ? ' ✓' : ' ✗ below fold'}`
      : '—';
    console.log(
      `${viewport.name.padEnd(20)} ${`${Math.round(vitals.lcpMs)}ms`.padEnd(10)} ${vitals.cls
        .toFixed(4)
        .padEnd(8)} ${vitals.lcpElement.padEnd(18)} ${fold}`,
    );
  }

  await browser.close();
  console.log('');
}

main().catch((error: unknown) => {
  console.error(`measure:vitals failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
