import { describe, expect, it } from 'vitest';

import { buildSignInPath, DEFAULT_RETURN_PATH, resolveReturnTo } from './returnTo';

describe('resolveReturnTo (open-redirect protection)', () => {
  it('keeps same-origin relative paths with query and hash', () => {
    expect(resolveReturnTo('/audit?outcome=DENIED#top')).toBe('/audit?outcome=DENIED#top');
    expect(resolveReturnTo('/jobs')).toBe('/jobs');
  });

  it.each([
    ['missing value', null],
    ['empty string', ''],
    ['absolute URL', 'https://evil.example/phish'],
    ['protocol-relative URL', '//evil.example'],
    ['backslash trick', '/\\evil.example'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['relative without slash', 'audit'],
    ['control character', '/jobs\n//evil.example'],
    ['tab character', '/\t/evil.example'],
    ['sign-in loop', '/sign-in?returnTo=%2Fjobs'],
  ])('falls back for %s', (_label, value) => {
    expect(resolveReturnTo(value)).toBe(DEFAULT_RETURN_PATH);
  });

  it('uses a caller-supplied fallback', () => {
    expect(resolveReturnTo('//evil.example', '/help')).toBe('/help');
  });
});

describe('buildSignInPath', () => {
  it('encodes the return path and expiry reason', () => {
    expect(buildSignInPath('/audit?page=2', 'expired')).toBe(
      '/sign-in?returnTo=%2Faudit%3Fpage%3D2&reason=expired',
    );
  });

  it('omits an unsafe return path', () => {
    expect(buildSignInPath('//evil.example')).toBe('/sign-in');
  });
});
