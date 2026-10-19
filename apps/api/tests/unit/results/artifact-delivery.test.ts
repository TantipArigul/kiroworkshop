import { validateHeaderValue } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  contentDisposition,
  downloadContentType,
  sanitizeFileName,
} from '../../../src/modules/results/artifact-delivery.js';

// Artifact Delivery helpers (design C6): filename sanitizer, Content-Disposition and the
// download content-type allowlist.

const ARTIFACT_ID = 'cartifact0000000000abcdefgh';
const FALLBACK = `result-${ARTIFACT_ID.slice(-8)}`;

describe('sanitizeFileName', () => {
  it.each([
    ['smart-checkup-result-12345678.json', 'smart-checkup-result-12345678.json'],
    ['fastq/sample_01.fastq.gz', 'sample_01.fastq.gz'],
    ['pipeline_info/execution_report_2026.html', 'execution_report_2026.html'],
    ['a\\b\\windows.tsv', 'windows.tsv'],
    ['x"y.tsv', 'xy.tsv'],
    ['line\r\nSet-Cookie: a=b.tsv', 'lineSet-Cookie: a=b.tsv'],
    ['tab\tand\u0000null\u007f.txt', 'tabandnull.txt'],
    ['  padded.txt  ', 'padded.txt'],
    ['résumé ü.tsv', 'résumé ü.tsv'],
  ])('%j → %j', (displayName, expected) => {
    expect(sanitizeFileName(displayName, ARTIFACT_ID)).toBe(expected);
  });

  it.each(['', 'dir/', '..', '.', '...', '\r\n', '"""', 'a/b/', '   '])(
    'falls back to result-{last8} for %j',
    (displayName) => {
      expect(sanitizeFileName(displayName, ARTIFACT_ID)).toBe(FALLBACK);
    },
  );
});

describe('contentDisposition', () => {
  it('builds an attachment with an ASCII filename and an RFC 5987 filename*', () => {
    expect(contentDisposition('attachment', 'report.tsv', { extended: true })).toBe(
      `attachment; filename="report.tsv"; filename*=UTF-8''report.tsv`,
    );
    expect(contentDisposition('attachment', "résumé (1)'*.tsv", { extended: true })).toBe(
      `attachment; filename="r_sum_ (1)'*.tsv"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%281%29%27%2A.tsv`,
    );
  });

  it('builds an inline header without filename* for the viewer', () => {
    expect(contentDisposition('inline', 'execution_report_x.html', { extended: false })).toBe(
      'inline; filename="execution_report_x.html"',
    );
  });

  it('produces a header Node accepts for any sanitized name', () => {
    for (const name of ['ünïcödé.html', 'a\r\nb', '日本語.tsv', 'x"y']) {
      const header = contentDisposition('attachment', sanitizeFileName(name, ARTIFACT_ID), {
        extended: true,
      });
      expect(() => validateHeaderValue('Content-Disposition', header)).not.toThrow();
      expect(header).not.toMatch(/[\r\n]/);
    }
  });
});

describe('downloadContentType (allowlist)', () => {
  it.each([
    ['result.json', 'application/json'],
    ['stats/all_fastq_statistics.tsv', 'text/tab-separated-values'],
    ['input.csv', 'text/csv'],
    ['fastq/sample.fastq.gz', 'application/gzip'],
    ['params.yml', 'text/plain'],
    ['params.YAML', 'text/plain'],
    ['REPORT.TSV', 'text/tab-separated-values'],
    ['pipeline_info/execution_report_x.html', 'application/octet-stream'],
    ['pipeline_info/pipeline_dag_x.html', 'application/octet-stream'],
    ['index.htm', 'application/octet-stream'],
    ['image.svg', 'application/octet-stream'],
    ['trace.txt', 'application/octet-stream'],
    ['reads.fastq', 'application/octet-stream'],
    ['noextension', 'application/octet-stream'],
    ['json', 'application/octet-stream'],
  ])('%s → %s', (fileName, expected) => {
    expect(downloadContentType(fileName)).toBe(expected);
  });
});
