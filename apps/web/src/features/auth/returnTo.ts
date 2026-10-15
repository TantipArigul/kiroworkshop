export const DEFAULT_RETURN_PATH = '/jobs';

const PLACEHOLDER_ORIGIN = 'https://return-to.invalid';
const AUTH_ENTRY_PATHS = ['/sign-in'];

/**
 * Accepts only same-origin relative paths so a crafted `returnTo` cannot redirect
 * the user to another site after sign-in (open-redirect protection).
 */
export function resolveReturnTo(
  value: string | null | undefined,
  fallback = DEFAULT_RETURN_PATH,
): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }

  // Reject control characters, which some browsers strip before navigating.
  if (Array.from(value).some((character) => character.charCodeAt(0) < 0x20)) {
    return fallback;
  }

  try {
    const url = new URL(value, PLACEHOLDER_ORIGIN);

    if (url.origin !== PLACEHOLDER_ORIGIN || AUTH_ENTRY_PATHS.includes(url.pathname)) {
      return fallback;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function buildSignInPath(currentPath: string, reason?: 'expired'): string {
  const params = new URLSearchParams();
  const returnTo = resolveReturnTo(currentPath, '');

  if (returnTo) {
    params.set('returnTo', returnTo);
  }

  if (reason) {
    params.set('reason', reason);
  }

  const query = params.toString();

  return query ? `/sign-in?${query}` : '/sign-in';
}
