import { LICENSE_NAME, LICENSE_TEXT } from './licenseText';

export const COOKIE_NOTICE =
  'This site uses one essential session cookie for sign-in. No tracking, analytics or third-party cookies.';

/**
 * Cookie notice (design C10, US-013 AC2). Informational only: there is nothing to consent to,
 * so no consent banner is shown. A new permanent cookie needs a consent design first (AC3).
 */
export function CookieNotice() {
  return (
    <aside aria-label="Cookies" className="cookie-notice">
      <svg aria-hidden="true" className="cookie-notice__icon" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7.5v.5" />
      </svg>
      <p>{COOKIE_NOTICE}</p>
    </aside>
  );
}

/** Public `/license` page; the text is a constant kept identical to the repo `LICENSE`. */
export function LicensePage() {
  return (
    <article aria-labelledby="license-title" className="guide license-page">
      <p className="eyebrow">Licence</p>
      <h1 id="license-title">{LICENSE_NAME}</h1>
      <p>SamNohserver source code is available under the following licence.</p>
      <div aria-label="Licence text" className="license-text" role="region" tabIndex={0}>
        <pre>{LICENSE_TEXT}</pre>
      </div>
      <CookieNotice />
    </article>
  );
}
