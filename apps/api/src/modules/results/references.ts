import type { PipelineId, ResultReference } from '@portal/shared';

/**
 * Approved reference links of a result (design C8, D3-8): the in-app guide for every pipeline
 * and tool documentation for Nextflow runs. No medical links. Changes go through a PR.
 */
const GUIDE_REFERENCE: ResultReference = {
  label: 'Guide: reading a result',
  href: '/help#results',
};

const NEXTFLOW_REFERENCES: readonly ResultReference[] = [
  { label: 'Nextflow documentation', href: 'https://www.nextflow.io/docs/latest/' },
  { label: 'si-lol/wf-renamefastq', href: 'https://github.com/si-lol/wf-renamefastq' },
];

export function referencesFor(pipelineId: PipelineId): ResultReference[] {
  return pipelineId === 'wf-renamefastq'
    ? [{ ...GUIDE_REFERENCE }, ...NEXTFLOW_REFERENCES.map((reference) => ({ ...reference }))]
    : [{ ...GUIDE_REFERENCE }];
}
