/**
 * Browser capabilities that are not always there.
 *
 * Several Web APIs are restricted to a *secure context* — HTTPS, or
 * localhost. ForgeRoutine is served over plain HTTP from an IP address,
 * which is not one, so `crypto.randomUUID` and `navigator.clipboard` are
 * simply absent in the deployed app while working perfectly in local
 * development. That gap is exactly the kind that ships.
 *
 * Everything here degrades instead of throwing. Serving the app over
 * HTTPS would make all of it unnecessary, and none of it does any harm
 * once that happens.
 */

/**
 * A unique-enough id for an idempotency key.
 *
 * `crypto.randomUUID` is secure-context-only. `crypto.getRandomValues` is
 * not — it is available over plain HTTP — so it is the first fallback, and
 * `Math.random` the last. The value only has to be unique among one user's
 * in-flight requests, so even the weakest branch is sufficient; it is
 * ordered this way because there is no reason to use a worse source than
 * the page actually offers.
 */
export function randomId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;

  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Copies text, by whichever route the page is allowed.
 *
 * `navigator.clipboard` is secure-context-only. The fallback is the old
 * `execCommand('copy')` over an off-screen textarea — deprecated, and the
 * only thing that works over plain HTTP.
 *
 * Returns whether it landed, so the caller can say "Copied" honestly
 * rather than showing a tick for something that did not happen.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission refused, or not focused. Fall through and try the
      // older route rather than reporting failure straight away.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Off-screen rather than hidden: a `display: none` element cannot be
  // selected, and selection is what execCommand copies.
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.setAttribute('readonly', '');

  try {
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    // In a finally, because execCommand can throw once it is appended —
    // and a failed copy that leaves a textarea in the document leaks one
    // element per attempt.
    textarea.remove();
  }
}
