import { rmSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, type Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createJobStorage, type JobStorage } from '../../../src/modules/jobs/job-storage.js';
import {
  DEFAULT_RUN_UPLOAD_LIMITS,
  receiveRunUpload,
  UploadRejectedError,
  type RunUploadLimits,
} from '../../../src/modules/pipelines/run-upload.js';
import {
  buildMultipart,
  buildMultipartChunks,
  launchParts,
  syntheticFastq,
  waitForStagedFile,
  type LaunchSpec,
  type MultipartPart,
} from '../../support/multipart.js';

let root: string;
let storage: JobStorage;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'portal-run-upload-'));
  storage = createJobStorage(root);
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

/** A request stand-in: the multipart body streamed with the headers busboy needs. */
function requestOf(parts: readonly MultipartPart[], contentType?: string): IncomingMessage {
  const multipart = buildMultipart(parts);
  const stream = new PassThrough();
  Object.assign(stream, {
    complete: true,
    headers: {
      'content-length': String(multipart.body.length),
      'content-type': contentType ?? multipart.contentType,
    },
  });
  setImmediate(() => stream.end(multipart.body));
  return stream as unknown as IncomingMessage;
}

/**
 * Streams the body part by part like a browser: each FASTQ part except the last is written
 * only after the receiver opened its file, so a later rejection never races an earlier file's
 * stream creation (that race was BUG-1; see the regression tests below).
 */
function pacedRequestOf(parts: readonly MultipartPart[]): IncomingMessage {
  const { chunks, contentType } = buildMultipartChunks(parts);
  const stream = new PassThrough();
  Object.assign(stream, { complete: true, headers: { 'content-type': contentType } });
  void (async () => {
    for (const [index, chunk] of chunks.entries()) {
      stream.write(chunk);
      const part = parts[index];

      if (index < chunks.length - 1 && part && 'filename' in part && part.name === 'fastq') {
        await waitForStagedFile(root, part.filename);
      }
    }

    stream.end();
  })();
  return stream as unknown as IncomingMessage;
}

function receivePaced(spec: LaunchSpec, limits?: RunUploadLimits) {
  return receiveRunUpload({ limits, request: pacedRequestOf(launchParts(spec)), storage });
}

function receive(spec: LaunchSpec | MultipartPart[], limits?: RunUploadLimits) {
  const parts = Array.isArray(spec) ? spec : launchParts(spec);
  return receiveRunUpload({ limits, request: requestOf(parts), storage });
}

async function stagingEntries(): Promise<string[]> {
  return readdir(join(root, 'uploads')).catch(() => []);
}

async function rejection(promise: Promise<unknown>): Promise<UploadRejectedError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(UploadRejectedError);
  return error as UploadRejectedError;
}

describe('receiveRunUpload (C3)', () => {
  it('streams fields, sample sheet and barcode-folder FASTQ files into one staging directory', async () => {
    const upload = await receive({
      files: ['run/barcode01/a.fastq.gz', 'run/barcode02/b.fastq'],
      layout: 'BARCODE_FOLDERS',
      sampleSheet: 'barcode,alias\nbarcode01,s01\nbarcode02,s02\n',
    });

    expect(upload.fields).toMatchObject({ layout: 'BARCODE_FOLDERS', runName: 'Synthetic run' });
    expect(upload.fastqFiles.map((file) => file.relativePath)).toEqual([
      'run/barcode01/a.fastq.gz',
      'run/barcode02/b.fastq',
    ]);
    expect(upload.fastqFiles.every((file) => file.sizeBytes > 0)).toBe(true);
    expect(upload.sampleSheet?.content).toContain('barcode01,s01');
    expect(await stagingEntries()).toEqual([upload.uploadId]);
    expect(await readdir(join(upload.directory, 'fastq', 'run'))).toEqual([
      'barcode01',
      'barcode02',
    ]);
    expect(await readFile(join(upload.directory, 'sample_sheet.csv'), 'utf8')).toContain('s02');
  });

  it.each([
    ['a parent-directory segment', '../escape.fastq', 'UNSAFE_PATH'],
    ['an absolute path', '/etc/reads.fastq', 'UNSAFE_PATH'],
    ['a hidden segment', '.hidden.fastq', 'UNSAFE_PATH'],
    ['a backslash', 'dir\\reads.fastq', 'UNSAFE_PATH'],
    ['a shell metacharacter', 'reads$(id).fastq', 'UNSAFE_PATH'],
  ])('rejects %s, audits UNSAFE_PATH and leaves no staging', async (_label, path, reason) => {
    const error = await rejection(receive({ files: [path], layout: 'SINGLE_FILE' }));

    expect(error.auditReason).toBe(reason);
    expect(error.issues).toEqual([{ field: 'files', message: expect.any(String) as string }]);
    expect(JSON.stringify(error.issues)).not.toContain(path);
    expect(await stagingEntries()).toEqual([]);
  });

  it.each([
    ['depth that does not match the layout', 'SAMPLE_FOLDER', 'reads.fastq'],
    ['a non-FASTQ extension', 'SINGLE_FILE', 'reads.txt'],
  ] as const)('rejects %s without an audit reason', async (_label, layout, path) => {
    const error = await rejection(receive({ files: [path], layout }));

    expect(error.auditReason).toBeNull();
    expect(await stagingEntries()).toEqual([]);
  });

  it('rejects a file sent before the layout field', async () => {
    const error = await rejection(
      receive([
        { content: syntheticFastq(), filename: 'reads.fastq', name: 'fastq' },
        { name: 'layout', value: 'SINGLE_FILE' },
      ]),
    );

    expect(error.issues[0]?.field).toBe('layout');
    expect(await stagingEntries()).toEqual([]);
  });

  it('rejects duplicate paths', async () => {
    const duplicate = await rejection(
      receivePaced({ files: ['d/a.fastq', 'd/a.fastq'], layout: 'SAMPLE_FOLDER' }),
    );

    expect(duplicate.issues[0]?.message).toContain('more than once');
    expect(await stagingEntries()).toEqual([]);
  });

  it('rejects unexpected file fields and repeated fields without staging', async () => {
    const unexpected = await rejection(
      receive([
        { name: 'layout', value: 'SINGLE_FILE' },
        { content: 'x', filename: 'x.bin', name: 'attachment' },
      ]),
    );
    const repeated = await rejection(
      receive([
        { name: 'layout', value: 'SINGLE_FILE' },
        { name: 'layout', value: 'SAMPLE_FOLDER' },
      ]),
    );

    expect(unexpected.issues[0]?.field).toBe('files');
    expect(repeated.issues[0]?.field).toBe('fields');
    expect(await stagingEntries()).toEqual([]);
  });

  it('checks the first bytes: gzip magic for .gz and "@" for plain FASTQ', async () => {
    const notGzip = await rejection(
      receive({
        files: [{ content: syntheticFastq(), path: 'reads.fastq.gz' }],
        layout: 'SINGLE_FILE',
      }),
    );
    const notFastq = await rejection(
      receive({ files: [{ content: 'hello', path: 'reads.fastq' }], layout: 'SINGLE_FILE' }),
    );
    const empty = await rejection(
      receive({ files: [{ content: '', path: 'reads.fastq' }], layout: 'SINGLE_FILE' }),
    );

    expect([notGzip, notFastq, empty].map((error) => error.issues[0])).toEqual([
      { field: 'file:reads.fastq.gz', message: 'The file is empty or is not a FASTQ file.' },
      { field: 'file:reads.fastq', message: 'The file is empty or is not a FASTQ file.' },
      { field: 'file:reads.fastq', message: 'The file is empty or is not a FASTQ file.' },
    ]);
    expect([notGzip, notFastq, empty].every((error) => error.auditReason === null)).toBe(true);

    expect(await stagingEntries()).toEqual([]);
  });

  it('enforces the injected file-count limit (LIMIT_EXCEEDED)', async () => {
    const tooMany = await rejection(
      receivePaced(
        { files: ['d/a.fastq', 'd/b.fastq', 'd/c.fastq'], layout: 'SAMPLE_FOLDER' },
        { maxFastqFiles: 2, maxTotalBytes: 200, sampleSheetMaxBytes: 32 },
      ),
    );

    expect(tooMany.auditReason).toBe('LIMIT_EXCEEDED');
    expect(tooMany.issues[0]?.message).toBe('Upload at most 2 FASTQ files and 200 bytes in total.');
    expect(await stagingEntries()).toEqual([]);
  });

  it('enforces the injected total-size limit (LIMIT_EXCEEDED)', async () => {
    // Two files under the per-file limit whose total exceeds it: the total counter trips while
    // the second file streams (a single oversized file trips busboy's per-file limit before
    // its stream opens — the BUG-1 race).
    const half = `@${'A'.repeat(149)}`;
    const tooLarge = await rejection(
      receivePaced(
        {
          files: [
            { content: half, path: 'd/a.fastq' },
            { content: half, path: 'd/b.fastq' },
          ],
          layout: 'SAMPLE_FOLDER',
        },
        { maxFastqFiles: 2, maxTotalBytes: 200, sampleSheetMaxBytes: 32 },
      ),
    );

    expect(tooLarge.auditReason).toBe('LIMIT_EXCEEDED');
    expect(await stagingEntries()).toEqual([]);
  });

  it('enforces the injected sheet-size limit without staging (LIMIT_EXCEEDED)', async () => {
    const sheetTooLarge = await rejection(
      receive(
        {
          files: ['run/barcode01/a.fastq'],
          layout: 'BARCODE_FOLDERS',
          sampleSheet: `barcode,alias\n${'barcode01,s01\n'.repeat(5)}`,
        },
        { maxFastqFiles: 2, maxTotalBytes: 200, sampleSheetMaxBytes: 32 },
      ),
    );

    expect(sheetTooLarge.auditReason).toBe('LIMIT_EXCEEDED');
    expect(sheetTooLarge.issues[0]).toEqual({
      field: 'sampleSheet',
      message: 'The sample sheet must be 32 bytes or smaller.',
    });
    expect(await stagingEntries()).toEqual([]);
  });

  // Regression (BUG-1, Phase 5): `fail()` used to remove the staging directory without waiting
  // for pending `createUploadFileStream` calls, which then re-created `uploads/{id}/fastq/...`.
  // Made deterministic by delaying the stream creation.
  it('BUG-1: a rejection while an earlier file stream is still opening leaves no staging', async () => {
    const slowStorage: JobStorage = {
      ...storage,
      createUploadFileStream: async (directory, relativePath) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return storage.createUploadFileStream(directory, relativePath);
      },
    };
    const error = await rejection(
      receiveRunUpload({
        limits: { maxFastqFiles: 1, maxTotalBytes: 4096, sampleSheetMaxBytes: 512 },
        request: requestOf(
          launchParts({ files: ['d/a.fastq', 'd/b.fastq'], layout: 'SAMPLE_FOLDER' }),
        ),
        storage: slowStorage,
      }),
    );

    expect(error.auditReason).toBe('LIMIT_EXCEEDED');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await stagingEntries()).toEqual([]);
  });

  // Regression (BUG-1b, Phase 5): a write stream created after the rejection used to be only
  // `destroy()`ed with no 'error' listener; a failed open then became an uncaught exception.
  // The removal is forced between the stream's mkdir and open here; the emit is intercepted so
  // a regression is reported as a failed assertion instead of crashing the test process.
  it('BUG-1b: a write stream opened after a rejection never emits an unhandled error', async () => {
    const unhandled: string[] = [];
    const racingStorage: JobStorage = {
      ...storage,
      createUploadFileStream: async (directory, relativePath) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const writer = (await storage.createUploadFileStream(directory, relativePath)) as Writable;
        rmSync(directory, { force: true, recursive: true });
        const emit = writer.emit.bind(writer);
        writer.emit = ((event: string, ...args: unknown[]) => {
          if (event === 'error' && writer.listenerCount('error') === 0) {
            unhandled.push(String((args[0] as NodeJS.ErrnoException | undefined)?.code));
            return true;
          }

          return emit(event, ...args);
        }) as typeof writer.emit;
        return writer as Awaited<ReturnType<JobStorage['createUploadFileStream']>>;
      },
    };

    await rejection(
      receiveRunUpload({
        limits: { maxFastqFiles: 1, maxTotalBytes: 4096, sampleSheetMaxBytes: 512 },
        request: requestOf(
          launchParts({ files: ['d/a.fastq', 'd/b.fastq'], layout: 'SAMPLE_FOLDER' }),
        ),
        storage: racingStorage,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(unhandled).toEqual([]);
  });

  it('formats the requirement limits as 10 files / 1 GB / 64 KB', async () => {
    expect(DEFAULT_RUN_UPLOAD_LIMITS).toEqual({
      maxFastqFiles: 10,
      maxTotalBytes: 1_073_741_824,
      sampleSheetMaxBytes: 65_536,
    });

    const files = Array.from({ length: 11 }, (_, index) => `d/r${index}.fastq`);
    const error = await rejection(receivePaced({ files, layout: 'SAMPLE_FOLDER' }));

    expect(error.issues[0]?.message).toBe('Upload at most 10 FASTQ files and 1 GB in total.');
  });

  it('rejects a non-UTF-8 sample sheet and a body that is not multipart', async () => {
    const latin1 = await rejection(
      receive([
        { name: 'layout', value: 'BARCODE_FOLDERS' },
        {
          content: Buffer.from([0x62, 0xe9, 0xff]),
          filename: 'sample_sheet.csv',
          name: 'sampleSheet',
        },
      ]),
    );
    const notMultipart = await rejection(
      receiveRunUpload({
        request: requestOf([{ name: 'layout', value: 'SINGLE_FILE' }], 'application/json'),
        storage,
      }),
    );

    expect(latin1.issues[0]).toEqual({
      field: 'sampleSheet',
      message: 'The sample sheet must be UTF-8 text.',
    });
    expect(notMultipart.issues[0]?.message).toBe('Send the run as multipart form data.');
    expect(await stagingEntries()).toEqual([]);
  });
});
