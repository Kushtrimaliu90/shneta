import type messages from '../src/i18n/messages/sq.json';
import type { routing } from '../src/i18n/routing';

/**
 * Typed message keys and locales (next-intl augmentation). `t('nav.shop')` is checked at
 * compile time, and an unknown key is a typecheck failure rather than a runtime blank.
 * `sq` is the reference locale; `check:i18n` guarantees `en` matches it.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
