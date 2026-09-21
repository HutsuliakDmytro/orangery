/**
 * URL handling for the link command.
 *
 * The rules themselves live in `@orangery/platform`: every app here opens
 * links out of documents it did not write, so which schemes are safe to hand
 * to the opener is one question with one answer. This file is the name Docs
 * knows it by.
 */

export { displayUrl, isSafeUrl, normalizeUrl } from '@orangery/platform'
