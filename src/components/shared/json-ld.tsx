/**
 * Renders a JSON-LD block. Kept in one component so every page emits it identically.
 *
 * `JSON.stringify` output is safe inside a `application/ld+json` script: the type is not
 * executable, and the only sequence that could break out of the element is `</script`, which
 * is escaped below. No user-supplied HTML ever reaches here — the builders in lib/seo.ts
 * take plain values.
 */
export function JsonLd({ schema }: { schema: Record<string, unknown> }) {
  const json = JSON.stringify(schema).replace(/</g, '\\u003c');

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
