import { EMAIL, PHONE, URL_RE, trimTrailingPunct } from "./patterns";

/**
 * Replaces email addresses, links and phone numbers with fixed tokens before any model call (SEC-AG-06),
 * so the model can't repeat contact details it never saw.
 */
export function redactContacts(text: string): string {
  const keepTrailing = (token: string) => (match: string) => token + match.slice(trimTrailingPunct(match).length);
  return text
    .replace(EMAIL, keepTrailing("[email]"))
    .replace(URL_RE, keepTrailing("[link]"))
    .replace(PHONE, "[phone]");
}
