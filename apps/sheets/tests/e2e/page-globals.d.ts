/**
 * What the specs put on the page before it loads.
 *
 * `loaded` answers with the URL a module was actually fetched under: the dev
 * server hands an edited module out under a timestamped one, and importing the
 * plain path would fetch a second copy with a store of its own — which looks
 * exactly like an app with no workbook open.
 */
declare function loaded(name: string): string
