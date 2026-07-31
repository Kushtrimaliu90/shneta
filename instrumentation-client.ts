/**
 * docs/02 §10 — browser error reporting.
 *
 * The SDK is loaded with a **dynamic import**, not a static one. A static
 * `import * as Sentry from '@sentry/nextjs'` at module scope puts the whole browser SDK
 * into the shared First Load JS chunk of every storefront route whether or not a DSN is
 * configured — measured at +84 kB, which takes the shell from 120 kB to 204 kB against the
 * 170 kB budget in docs/09 §3. On a mobile connection in Kosovo that is real LCP cost
 * traded for telemetry.
 *
 * Loading it lazily puts it in its own async chunk: nothing ships when the DSN is unset,
 * and when it is set the cost lands after first paint instead of blocking it. Server-side
 * Sentry (instrumentation.ts) has no client cost at all and catches the errors that
 * actually threaten order integrity.
 *
 * Session Replay stays off deliberately: it records form fields, so it would capture
 * addresses and payment intent at checkout, against the data minimisation in docs/01 §4.
 */
type TransitionHook = (href: string, navigationType: string) => void;

let transitionHook: TransitionHook | undefined;

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';

if (dsn) {
  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn,
      enabled: true,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.user) event.user = { id: event.user.id };
        if (event.request?.cookies) delete event.request.cookies;
        return event;
      },
    });
    transitionHook = Sentry.captureRouterTransitionStart;
  });
}

/** No-ops until the SDK has loaded, and forever if no DSN is configured. */
export const onRouterTransitionStart: TransitionHook = (href, navigationType) => {
  transitionHook?.(href, navigationType);
};
