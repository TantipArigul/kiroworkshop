import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LICENSE_NAME, LICENSE_TEXT } from './licenseText';

const normalize = (text: string) => text.replace(/\r\n?/g, '\n');
// apps/web/src/features/legal → repository root.
const repositoryLicense = readFileSync(new URL('../../../../../LICENSE', import.meta.url), 'utf8');

describe('licence text (US-013 AC1)', () => {
  it('matches the repository LICENSE exactly after normalizing line endings', () => {
    expect(normalize(LICENSE_TEXT)).toBe(normalize(repositoryLicense));
  });

  it('is the MIT licence for SamNohserver contributors', () => {
    const lines = LICENSE_TEXT.split('\n');

    expect(lines[0]).toBe(LICENSE_NAME);
    expect(lines[2]).toBe('Copyright (c) 2026 SamNohserver contributors');
  });
});
