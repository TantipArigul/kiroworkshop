import { describe, expect, it } from 'vitest';

import {
  buildProgress,
  failureSummary,
  parseSubmitted,
  parseTrace,
  processStepName,
} from '../../../src/modules/pipelines/nextflow-progress.js';

const HEADER =
  'task_id\thash\tnative_id\tname\tstatus\texit\tsubmit\tduration\trealtime\t%cpu\tpeak_rss';
const row = (hash: string, name: string, status: string, exit: string) =>
  `1\t${hash}\t1\t${name}\t${status}\t${exit}\t2026-10-18\t1s\t1s\t1%\t1 MB`;
const PREFIX = 'WF_RENAMEFASTQ:RENAMEFASTQ';

describe('processStepName (no task tags leave the parser)', () => {
  it.each([
    [`${PREFIX}:FASTCAT (patient smith)`, 'FASTCAT'],
    [`${PREFIX}:DORADO_DEMULTIPLEX (fastq_pass)`, 'DORADO_DEMULTIPLEX'],
    ['SEQKIT_STATS', 'SEQKIT_STATS'],
    [`${PREFIX}:BAD STEP`, null],
    [`${PREFIX}:$(rm -rf)`, null],
    ['', null],
    [`${PREFIX}:${'X'.repeat(65)}`, null],
  ])('%j → %j', (name, expected) => {
    expect(processStepName(name)).toBe(expected);
  });
});

describe('parseTrace (spike 1.1 OQ1 format)', () => {
  it('reads hash, process, status and exit by header name', () => {
    const trace = [
      HEADER,
      row('ab/cdef12', `${PREFIX}:FASTCAT (s1)`, 'COMPLETED', '0'),
      row('12/345678', `${PREFIX}:SEQKIT (s1)`, 'FAILED', '1'),
      '',
    ].join('\n');

    expect(parseTrace(trace)).toEqual([
      { exit: '0', hash: 'ab/cdef12', process: 'FASTCAT', status: 'COMPLETED' },
      { exit: '1', hash: '12/345678', process: 'SEQKIT', status: 'FAILED' },
    ]);
  });

  it('returns no rows for an empty file, a header-only file or an unknown header', () => {
    expect(parseTrace('')).toEqual([]);
    expect(parseTrace(`${HEADER}\n`)).toEqual([]);
    expect(parseTrace('foo\tbar\nx\ty')).toEqual([]);
  });
});

describe('parseSubmitted (stdout with -ansi-log false)', () => {
  it('keeps submitted tasks in order and drops tags and other lines', () => {
    const stdout = [
      'N E X T F L O W  ~  version 26.10.2',
      `[5f/ef1989] Submitted process > ${PREFIX}:DORADO_DEMULTIPLEX (fastq_pass)`,
      `[ab/cdef12] Submitted process > ${PREFIX}:FASTCAT (alias with spaces)`,
      `[zz/zzzzzz] Submitted process > ${PREFIX}:NOT_A_HASH (x)`,
      `ERROR ~ Error executing process > '${PREFIX}:FASTCAT (s1)'`,
    ].join('\r\n');

    expect(parseSubmitted(stdout)).toEqual([
      { hash: '5f/ef1989', process: 'DORADO_DEMULTIPLEX' },
      { hash: 'ab/cdef12', process: 'FASTCAT' },
    ]);
    expect(JSON.stringify(parseSubmitted(stdout))).not.toContain('alias');
  });
});

describe('buildProgress (US-020 AC3)', () => {
  const startedAt = new Date('2026-10-18T01:00:00.000Z');

  it('counts COMPLETED/CACHED rows and reports the latest unfinished submitted step', () => {
    const trace = [
      HEADER,
      row('aa/000001', `${PREFIX}:A (x)`, 'COMPLETED', '0'),
      row('aa/000002', `${PREFIX}:B (x)`, 'CACHED', '0'),
      row('aa/000003', `${PREFIX}:C (x)`, 'ABORTED', '-'),
    ].join('\n');
    const stdout = [
      `[aa/000001] Submitted process > ${PREFIX}:A (x)`,
      `[aa/000002] Submitted process > ${PREFIX}:B (x)`,
      `[aa/000004] Submitted process > ${PREFIX}:FASTCAT (x)`,
      `[aa/000003] Submitted process > ${PREFIX}:C (x)`,
    ].join('\n');

    expect(buildProgress(trace, stdout, startedAt)).toEqual({
      completedSteps: 2,
      currentStep: 'FASTCAT',
      startedAt: '2026-10-18T01:00:00.000Z',
    });
  });

  it('reports no current step before the first submission or after all finished', () => {
    expect(buildProgress('', '', startedAt)).toEqual({
      completedSteps: 0,
      currentStep: null,
      startedAt: startedAt.toISOString(),
    });
    expect(
      buildProgress(
        `${HEADER}\n${row('aa/000001', `${PREFIX}:A (x)`, 'COMPLETED', '0')}`,
        `[aa/000001] Submitted process > ${PREFIX}:A (x)`,
        startedAt,
      ).currentStep,
    ).toBeNull();
  });
});

describe('failureSummary (safe summary, US-019 AC5)', () => {
  it('names only the first failed step and a numeric exit code', () => {
    const trace = [
      HEADER,
      row('aa/000001', `${PREFIX}:FASTCAT (patient-01)`, 'COMPLETED', '0'),
      row('aa/000002', `${PREFIX}:SEQKIT_STATS (patient-01)`, 'FAILED', '137'),
      row('aa/000003', `${PREFIX}:OTHER (patient-01)`, 'FAILED', '1'),
    ].join('\n');
    const summary = failureSummary(trace);

    expect(summary).toBe('Step SEQKIT_STATS failed (exit 137). Check the input and submit again.');
    expect(summary).not.toContain('patient');
  });

  it('replaces a non-numeric exit and falls back when no step failed', () => {
    expect(failureSummary(`${HEADER}\n${row('a/b', `${PREFIX}:X (t)`, 'FAILED', '-')}`)).toBe(
      'Step X failed (exit unknown). Check the input and submit again.',
    );
    expect(failureSummary(`${HEADER}\n${row('a/b', `${PREFIX}:BAD NAME`, 'FAILED', '1')}`)).toBe(
      'The pipeline did not finish. Check the input and submit again.',
    );
    expect(failureSummary('')).toBe(
      'The pipeline did not finish. Check the input and submit again.',
    );
  });
});
