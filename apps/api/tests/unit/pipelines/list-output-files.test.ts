import { describe, expect, it } from 'vitest';

import { createPipelineRunService } from '../../../src/modules/pipelines/pipeline-run.service.js';

type ServiceOptions = Parameters<typeof createPipelineRunService>[0];

const JOB_ID = 'clistoutputs000000000000';
const logger = { info: () => undefined, warn: () => undefined };

function serviceWith(prisma?: ServiceOptions['prisma']) {
  // listOutputFiles only reads JobOutputFile rows; the other collaborators are never called.
  return createPipelineRunService({
    audit: {} as ServiceOptions['audit'],
    availability: () => ({ available: true, unavailableReason: null }),
    jobs: {} as ServiceOptions['jobs'],
    logger,
    prisma,
    storage: {} as ServiceOptions['storage'],
  });
}

describe('PipelineRunService.listOutputFiles (Results & Guidance, design C5)', () => {
  it('returns the job manifest read-only, scoped to the job and ordered by path', async () => {
    const queries: unknown[] = [];
    const prisma = {
      jobOutputFile: {
        findMany: (query: unknown) => {
          queries.push(query);
          return Promise.resolve([
            {
              category: 'REPORT',
              contentType: 'text/html',
              id: 'coutput00000000000000001',
              relativePath: 'pipeline_info/execution_report_x.html',
              sizeBytes: 10,
            },
            {
              category: 'UNKNOWN',
              contentType: 'text/tab-separated-values',
              id: 'coutput00000000000000002',
              relativePath: 'stats/all_fastq_statistics.tsv',
              sizeBytes: 5,
            },
          ]);
        },
      },
    } as unknown as ServiceOptions['prisma'];

    await expect(serviceWith(prisma).listOutputFiles(JOB_ID)).resolves.toEqual([
      {
        category: 'REPORT',
        contentType: 'text/html',
        id: 'coutput00000000000000001',
        relativePath: 'pipeline_info/execution_report_x.html',
        sizeBytes: 10,
      },
      {
        category: 'STATS',
        contentType: 'text/tab-separated-values',
        id: 'coutput00000000000000002',
        relativePath: 'stats/all_fastq_statistics.tsv',
        sizeBytes: 5,
      },
    ]);
    expect(queries).toEqual([
      {
        orderBy: { relativePath: 'asc' },
        select: {
          category: true,
          contentType: true,
          id: true,
          relativePath: true,
          sizeBytes: true,
        },
        where: { jobId: JOB_ID },
      },
    ]);
  });

  it('refuses to read without a configured database client', async () => {
    await expect(serviceWith().listOutputFiles(JOB_ID)).rejects.toThrow(
      'The output manifest reader is not configured.',
    );
  });
});
