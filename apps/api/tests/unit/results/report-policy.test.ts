import { describe, expect, it } from 'vitest';
import { referencesFor } from '../../../src/modules/results/references.js';
import {
  DOWNLOAD_CONTENT_SECURITY_POLICY,
  DOWNLOAD_ONLY_REPORT_NOTE,
  reportPolicy,
  VIEW_CONTENT_SECURITY_POLICY,
} from '../../../src/modules/results/report-policy.js';

// Report policy (design C6, Conflicts 1–2) and approved references (design C8, D3-8).

const NOT_VIEWABLE = { viewable: false, viewNote: null };
const DOWNLOAD_ONLY = { viewable: false, viewNote: DOWNLOAD_ONLY_REPORT_NOTE };

describe('reportPolicy — viewable allowlist', () => {
  it.each([
    'pipeline_info/execution_report_2026-10-19_10-00-00.html',
    'pipeline_info/execution_timeline_2026-10-19_10-00-00.html',
    'pipeline_info/execution_report_.html',
  ])('wf-renamefastq REPORT %s is viewable', (relativePath) => {
    expect(
      reportPolicy({ category: 'REPORT', pipelineId: 'wf-renamefastq', relativePath }),
    ).toEqual({ viewable: true, viewNote: null });
  });

  it('marks the DAG report download-only with its note', () => {
    expect(DOWNLOAD_ONLY_REPORT_NOTE).toBe(
      'This report loads scripts from the internet, so it can only be downloaded.',
    );
    expect(
      reportPolicy({
        category: 'REPORT',
        pipelineId: 'wf-renamefastq',
        relativePath: 'pipeline_info/pipeline_dag_2026-10-19_10-00-00.html',
      }),
    ).toEqual(DOWNLOAD_ONLY);
  });

  it.each([
    // Wrong folder, nesting, suffix or name.
    ['REPORT', 'execution_report_x.html'],
    ['REPORT', 'other/pipeline_info/execution_report_x.html'],
    ['REPORT', 'pipeline_info/sub/execution_report_x.html'],
    ['REPORT', 'pipeline_info/execution_report_x.html.gz'],
    ['REPORT', 'pipeline_info/execution_report_x.htm'],
    ['REPORT', 'pipeline_info/execution_trace_x.html'],
    ['REPORT', 'pipeline_info/report.html'],
    ['REPORT', 'pipeline_info/EXECUTION_REPORT_x.html'],
    // Right name, wrong category.
    ['OTHER', 'pipeline_info/execution_report_x.html'],
    ['STATS', 'pipeline_info/execution_timeline_x.html'],
    ['READS', 'fastq/sample.fastq.gz'],
    ['RESULT', 'smart-checkup-result-12345678.json'],
  ] as const)('%s %s is not viewable', (category, relativePath) => {
    expect(reportPolicy({ category, pipelineId: 'wf-renamefastq', relativePath })).toEqual(
      NOT_VIEWABLE,
    );
  });

  it('never makes a Smart Checkup file viewable, even with a report-like name', () => {
    for (const relativePath of [
      'pipeline_info/execution_report_x.html',
      'pipeline_info/pipeline_dag_x.html',
    ]) {
      expect(
        reportPolicy({ category: 'REPORT', pipelineId: 'smart-checkup', relativePath }),
      ).toEqual(NOT_VIEWABLE);
    }
  });
});

describe('content security policies', () => {
  it('sandboxes every download without any allowance', () => {
    expect(DOWNLOAD_CONTENT_SECURITY_POLICY).toBe("sandbox; default-src 'none'");
  });

  it('sandboxes the viewer with allow-scripts only and blocks all network access', () => {
    expect(VIEW_CONTENT_SECURITY_POLICY).toBe(
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; " +
        "style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; " +
        "form-action 'none'; frame-ancestors 'self'",
    );
    const directives = VIEW_CONTENT_SECURITY_POLICY.split('; ');
    expect(directives[0]).toBe('sandbox allow-scripts');
    expect(VIEW_CONTENT_SECURITY_POLICY).not.toContain('allow-same-origin');
    expect(VIEW_CONTENT_SECURITY_POLICY).not.toContain('unsafe-eval');
    expect(VIEW_CONTENT_SECURITY_POLICY).not.toMatch(/https?:|\*/);
    expect(directives).not.toContain('connect-src');
  });
});

describe('referencesFor', () => {
  it('lists only the in-app guide for Smart Checkup', () => {
    expect(referencesFor('smart-checkup')).toEqual([
      { href: '/help#results', label: 'Guide: reading a result' },
    ]);
  });

  it('adds the Nextflow and pipeline documentation for wf-renamefastq', () => {
    expect(referencesFor('wf-renamefastq')).toEqual([
      { href: '/help#results', label: 'Guide: reading a result' },
      { href: 'https://www.nextflow.io/docs/latest/', label: 'Nextflow documentation' },
      { href: 'https://github.com/si-lol/wf-renamefastq', label: 'si-lol/wf-renamefastq' },
    ]);
  });

  it('returns fresh copies, so callers cannot change the approved list', () => {
    const first = referencesFor('wf-renamefastq');
    first[0]!.href = '/changed';
    expect(referencesFor('wf-renamefastq')[0]?.href).toBe('/help#results');
  });
});
