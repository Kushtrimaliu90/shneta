/**
 * Below two characters every query matches half the catalogue, so the overlay says so rather
 * than running the search.
 *
 * In its own module because `actions.ts` carries `'use server'`, and such a file may export
 * **only async functions** — a plain `export const` there is a build error, not a lint warning.
 * The same rule is why the result types live here too: a type export is erased and would be
 * fine, but keeping the constant and the shapes together is easier to find than splitting them.
 */
export const MIN_QUERY_LENGTH = 2;
