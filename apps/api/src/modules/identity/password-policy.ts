import { readFileSync } from 'node:fs';

import { PASSWORD_MAX_LENGTH } from '@portal/shared/constants';

/** D3-3: 12 is a user-accepted deviation from NIST SP 800-63B-4 (15 for single-factor). */
export const PASSWORD_MIN_LENGTH = 12;

export type PasswordViolation =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'MATCHES_IDENTIFIER'
  | 'COMMON_PASSWORD'
  /** Checked by the identity service against the stored hash, not by `checkPassword`. */
  | 'MATCHES_CURRENT';

export const PASSWORD_VIOLATION_MESSAGES: Readonly<Record<PasswordViolation, string>> = {
  TOO_SHORT: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  TOO_LONG: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  MATCHES_IDENTIFIER: 'Do not use your e-mail address as your password.',
  COMMON_PASSWORD: 'This password is too common. Choose a different one.',
  MATCHES_CURRENT: 'Choose a password that is different from your current one.',
};

let commonPasswords: ReadonlySet<string> | null = null;

/** Loads the bundled SecLists-derived denylist once (see the file header for source and licence). */
function getCommonPasswords(): ReadonlySet<string> {
  if (!commonPasswords) {
    const content = readFileSync(new URL('./common-passwords.txt', import.meta.url), 'utf8');
    commonPasswords = new Set(
      content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#')),
    );
  }

  return commonPasswords;
}

/**
 * Returns every policy violation. Length counts Unicode code points; the whole password is
 * compared (case-insensitively) against the denylist, never substrings. No composition rules.
 */
export function checkPassword(password: string, email: string): PasswordViolation[] {
  const violations: PasswordViolation[] = [];
  const length = Array.from(password).length;
  const normalized = password.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  const localPart = normalizedEmail.split('@')[0] ?? '';

  if (length < PASSWORD_MIN_LENGTH) {
    violations.push('TOO_SHORT');
  }

  if (length > PASSWORD_MAX_LENGTH) {
    violations.push('TOO_LONG');
  }

  if (normalized === normalizedEmail || (localPart.length > 0 && normalized === localPart)) {
    violations.push('MATCHES_IDENTIFIER');
  }

  if (getCommonPasswords().has(normalized)) {
    violations.push('COMMON_PASSWORD');
  }

  return violations;
}
