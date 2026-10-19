import type { JobProgress } from '@portal/shared';

/**
 * Parsers for Nextflow's `-with-trace` TSV and `-ansi-log false` stdout (spike 1.1, OQ1).
 * Only process names leave this module — never task tags, which can carry sample aliases.
 */

export type TraceRow = { hash: string; process: string | null; status: string; exit: string };

const STEP_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const SUBMITTED_PATTERN =
  /^\[([0-9a-f]{2}\/[0-9a-f]{6})\] Submitted process > ([A-Za-z0-9_:]+)(?: \((.*)\))?$/;
const DONE_STATUSES = new Set(['COMPLETED', 'CACHED']);

/** `WF_RENAMEFASTQ:RENAMEFASTQ:FASTCAT (tag)` → `FASTCAT`; anything unexpected → `null`. */
export function processStepName(qualifiedName: string): string | null {
  const withoutTag = qualifiedName.replace(/ \(.*\)$/, '');
  const step = withoutTag.split(':').at(-1) ?? '';
  return STEP_NAME_PATTERN.test(step) ? step : null;
}

export function parseTrace(content: string): TraceRow[] {
  const [headerLine, ...lines] = content.split(/\r?\n/);
  const header = (headerLine ?? '').split('\t');
  const column = (name: string) => header.indexOf(name);
  const hashAt = column('hash');
  const nameAt = column('name');
  const statusAt = column('status');
  const exitAt = column('exit');

  if (hashAt < 0 || nameAt < 0 || statusAt < 0) {
    return [];
  }

  return lines
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const cells = line.split('\t');
      return {
        exit: exitAt >= 0 ? (cells[exitAt] ?? '') : '',
        hash: cells[hashAt] ?? '',
        process: processStepName(cells[nameAt] ?? ''),
        status: cells[statusAt] ?? '',
      };
    });
}

/** `Submitted process >` lines in order: task hash and process step name. */
export function parseSubmitted(stdout: string): { hash: string; process: string | null }[] {
  return stdout.split(/\r?\n/).flatMap((line) => {
    const match = SUBMITTED_PATTERN.exec(line.trim());
    return match ? [{ hash: match[1] ?? '', process: processStepName(match[2] ?? '') }] : [];
  });
}

/**
 * Completed steps = trace rows COMPLETED/CACHED (ABORTED/FAILED are not done); the current step
 * is the latest submitted task that has no trace row yet.
 */
export function buildProgress(trace: string, stdout: string, startedAt: Date): JobProgress {
  const rows = parseTrace(trace);
  const finished = new Set(rows.map((row) => row.hash));
  const submitted = parseSubmitted(stdout);
  const running = submitted.filter((task) => !finished.has(task.hash)).at(-1);

  return {
    completedSteps: rows.filter((row) => DONE_STATUSES.has(row.status)).length,
    currentStep: running?.process ?? null,
    startedAt: startedAt.toISOString(),
  };
}

/** Safe failure summary naming only the failed step and its exit code. */
export function failureSummary(trace: string): string {
  const failed = parseTrace(trace).find((row) => row.status === 'FAILED');

  if (failed?.process) {
    const exit = /^-?\d{1,4}$/.test(failed.exit) ? failed.exit : 'unknown';
    return `Step ${failed.process} failed (exit ${exit}). Check the input and submit again.`;
  }

  return 'The pipeline did not finish. Check the input and submit again.';
}
