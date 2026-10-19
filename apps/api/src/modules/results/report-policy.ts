import type { ResultArtifactCategory } from '@portal/shared';

/**
 * HTML report viewer policy (design C6, US-009 AC5–6). Only Nextflow's self-contained execution
 * report and timeline are shown, inside `<iframe sandbox="allow-scripts">` with a CSP that
 * also sandboxes the response (opaque origin) and forbids every network request. To disable the
 * viewer in an incident, empty `VIEWABLE_REPORT_PATTERNS`; downloads keep working.
 */
const VIEWABLE_PIPELINE_ID = 'wf-renamefastq';
const VIEWABLE_REPORT_PATTERNS: readonly RegExp[] = [
  /^pipeline_info\/execution_report_[^/]*\.html$/,
  /^pipeline_info\/execution_timeline_[^/]*\.html$/,
];
/** The DAG report loads mermaid from a CDN, which the viewer CSP blocks (design Conflict 2). */
const DOWNLOAD_ONLY_REPORT_PATTERN = /^pipeline_info\/pipeline_dag_[^/]*\.html$/;

export const DOWNLOAD_ONLY_REPORT_NOTE =
  'This report loads scripts from the internet, so it can only be downloaded.';

/** CSP of every download: the response is never treated as an active document. */
export const DOWNLOAD_CONTENT_SECURITY_POLICY = "sandbox; default-src 'none'";

/** CSP of the report viewer: scripts run only in an opaque origin without network access. */
export const VIEW_CONTENT_SECURITY_POLICY = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

export type ReportPolicyInput = {
  pipelineId: string;
  category: ResultArtifactCategory;
  /** Path relative to `jobs/{id}/output` (or the generated file name). */
  relativePath: string;
};

export function reportPolicy(input: ReportPolicyInput): {
  viewable: boolean;
  viewNote: string | null;
} {
  if (input.pipelineId !== VIEWABLE_PIPELINE_ID || input.category !== 'REPORT') {
    return { viewable: false, viewNote: null };
  }

  if (VIEWABLE_REPORT_PATTERNS.some((pattern) => pattern.test(input.relativePath))) {
    return { viewable: true, viewNote: null };
  }

  return DOWNLOAD_ONLY_REPORT_PATTERN.test(input.relativePath)
    ? { viewable: false, viewNote: DOWNLOAD_ONLY_REPORT_NOTE }
    : { viewable: false, viewNote: null };
}
