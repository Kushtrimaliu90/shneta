/**
 * A no-op stand-in for the `server-only` package, aliased in by `vitest.integration.config.mts`.
 *
 * The real package's browser entry point throws on import, and Vitest's node environment resolves that
 * entry rather than the server one — so any module under test that declares `import 'server-only'` would
 * fail before its first line ran. See the note on the alias for why stubbing it removes nothing: the
 * guarantee is enforced by `next build` against the client bundle, and a test runner is not a browser.
 *
 * Empty on purpose. The real server entry point is empty too.
 */
export {};
