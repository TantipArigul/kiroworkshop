import type { ResultArtifact } from '@portal/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactList } from './ArtifactList';

// Artifact grouping and actions (design C8, US-011).

const JOB_ID = 'cjobartifactlist000000001';

function artifact(overrides: Partial<ResultArtifact>): ResultArtifact {
  return {
    category: 'OTHER',
    contentType: 'application/octet-stream',
    displayName: 'file.bin',
    id: 'cartifact000000000000001',
    kind: 'OUTPUT',
    sizeBytes: 2048,
    viewable: false,
    viewNote: null,
    ...overrides,
  };
}

const ARTIFACTS: ResultArtifact[] = [
  artifact({
    category: 'REPORT',
    displayName: 'pipeline_info/execution_report_x.html',
    id: 'creport00000000000000001',
    viewable: true,
  }),
  artifact({
    category: 'OTHER',
    displayName: 'pipeline_info/execution_trace_x.txt',
    id: 'cother000000000000000001',
  }),
  artifact({
    category: 'READS',
    displayName: 'fastq/sample_b.fastq.gz',
    id: 'creads000000000000000002',
  }),
  artifact({
    category: 'REPORT',
    displayName: 'pipeline_info/pipeline_dag_x.html',
    id: 'creport00000000000000002',
    viewNote: 'This report loads scripts from the internet, so it can only be downloaded.',
  }),
  artifact({
    category: 'STATS',
    displayName: 'stats/all_fastq_statistics.tsv',
    id: 'cstats000000000000000001',
  }),
  artifact({
    category: 'READS',
    displayName: 'fastq/sample_a.fastq.gz',
    id: 'creads000000000000000001',
  }),
];

const headings = (html: string) =>
  [...html.matchAll(/<h3 id="artifacts-[A-Z]+">([^<]+)<\/h3>/g)].map((m) => m[1]);
const count = (html: string, text: string) => html.split(text).length - 1;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('ArtifactList', () => {
  const html = renderToStaticMarkup(<ArtifactList artifacts={ARTIFACTS} jobId={JOB_ID} />);

  it('groups files by category in a fixed order with counts, skipping empty groups', () => {
    expect(headings(html)).toEqual([
      'Reads (2)',
      'Statistics (1)',
      'Reports (2)',
      'Other files (1)',
    ]);
    expect(html).not.toContain('artifacts-RESULT');
    // Order inside a group follows the API order.
    expect(html.indexOf('sample_b.fastq.gz')).toBeLessThan(html.indexOf('sample_a.fastq.gz'));
  });

  it('offers Download for every file as a same-origin attachment link', () => {
    expect(count(html, '>Download<')).toBe(ARTIFACTS.length);
    expect(html).toContain(
      `download="" href="/api/v1/jobs/${JOB_ID}/artifacts/cstats000000000000000001/download"`,
    );
  });

  it('offers View and Open in new tab only for viewable reports', () => {
    expect(count(html, '>View<')).toBe(1);
    expect(count(html, 'Open in new tab')).toBe(1);
    expect(html).toContain(
      `href="/api/v1/jobs/${JOB_ID}/artifacts/creport00000000000000001/view" rel="noopener noreferrer" target="_blank"`,
    );
    expect(html).toContain('aria-expanded="false"');
    // The viewer is closed until View is pressed.
    expect(html).not.toContain('<iframe');
  });

  it('shows the download-only note of the DAG report', () => {
    expect(html).toContain(
      'This report loads scripts from the internet, so it can only be downloaded.',
    );
    expect(html).not.toContain('creport00000000000000002/view');
  });

  it('shows sizes and an empty state', () => {
    expect(html).toContain('<span>2.0 KB</span>');
    expect(renderToStaticMarkup(<ArtifactList artifacts={[]} jobId={JOB_ID} />)).toContain(
      'No files were recorded for this job.',
    );
  });

  it('never links to files in mock mode', async () => {
    vi.stubEnv('VITE_API_MOCK', 'true');
    vi.resetModules();
    const { ArtifactList: MockArtifactList } = await import('./ArtifactList');
    const mock = renderToStaticMarkup(<MockArtifactList artifacts={ARTIFACTS} jobId={JOB_ID} />);
    expect(mock).toContain('Downloads and report views: not available in mock mode.');
    expect(mock).not.toContain('/api/v1/jobs/');
    expect(mock).not.toContain('>Download<');
    expect(count(mock, '>View<')).toBe(1);
  });
});
