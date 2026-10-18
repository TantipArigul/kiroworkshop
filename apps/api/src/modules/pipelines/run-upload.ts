import { writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import type { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import busboy from 'busboy';

import {
  isFastqFileName,
  RUN_INPUT_LAYOUT_DEPTH,
  RUN_INPUT_MAX_BYTES,
  RUN_INPUT_MAX_FASTQ_FILES,
  SAMPLE_SHEET_MAX_BYTES,
  splitRelativePath,
  type RunInputLayout,
} from '@portal/shared';

import { resolvePrivateStoragePath, StoragePathError } from '../../infrastructure/storage-path.js';
import type { JobStorage } from '../jobs/job-storage.js';
import {
  FASTQ_DIRECTORY,
  SAMPLE_SHEET_FILE_NAME,
  type ReceivedRunUpload,
} from './run-input-validator.js';

export type RunUploadLimits = {
  maxFastqFiles: number;
  maxTotalBytes: number;
  sampleSheetMaxBytes: number;
};

/** Requirement limits (1 GiB, 10 FASTQ, 64 KB sheet); tests inject smaller values. */
export const DEFAULT_RUN_UPLOAD_LIMITS: RunUploadLimits = {
  maxFastqFiles: RUN_INPUT_MAX_FASTQ_FILES,
  maxTotalBytes: RUN_INPUT_MAX_BYTES,
  sampleSheetMaxBytes: SAMPLE_SHEET_MAX_BYTES,
};

const TEXT_FIELD_COUNT = 8;
const TEXT_FIELD_MAX_BYTES = 8192;
const PARTS_MAX = 24;
const GZIP_MAGIC = [0x1f, 0x8b] as const;
const FASTQ_RECORD_START = 0x40; // '@'

export type UploadAuditReason = 'UNSAFE_PATH' | 'LIMIT_EXCEEDED';
export type UploadIssue = { field: string; message: string };

/** The upload was rejected while streaming; its staging directory is already removed. */
export class UploadRejectedError extends Error {
  public constructor(
    public readonly issues: readonly UploadIssue[],
    public readonly auditReason: UploadAuditReason | null,
  ) {
    super('The upload was rejected.');
    this.name = 'UploadRejectedError';
  }
}

export type RunUpload = ReceivedRunUpload & { uploadId: string; directory: string };

const MESSAGES = {
  notMultipart: 'Send the run as multipart form data.',
  unreadable: 'The upload could not be read. Please try again.',
  fieldsFirst: 'Send the run fields before the files.',
  layout: 'Choose an input type.',
  fieldTooLong: 'A field value is too long.',
  fieldTwice: 'Each field may be sent only once.',
  tooManyParts: 'The upload has too many parts.',
  unexpectedFile: 'Unexpected file field.',
  unsafePath:
    'File and folder names may only use letters, numbers, dots, dashes and underscores, and must not start with a dot.',
  depth: 'The selected files do not match the chosen input type.',
  notFastq: 'Only .fastq, .fq, .fastq.gz and .fq.gz files are accepted.',
  duplicate: 'The same file was selected more than once.',
  badContent: 'The file is empty or is not a FASTQ file.',
  sheetTwice: 'Send one sample sheet only.',
  sheetEncoding: 'The sample sheet must be UTF-8 text.',
} as const;

/**
 * Streams a launch `multipart/form-data` body into `uploads/{uploadId}/` (design C3). Every
 * client path is checked (segments, depth, extension) and confined to the staging directory
 * before a write stream opens; counts, total bytes and the first bytes of each file are checked
 * while streaming. Any rejection stops reading, destroys the streams and removes the staging
 * directory before the promise rejects, so nothing is left on disk.
 */
export async function receiveRunUpload(input: {
  request: IncomingMessage;
  storage: JobStorage;
  limits?: RunUploadLimits;
}): Promise<RunUpload> {
  const { request, storage } = input;
  const limits = input.limits ?? DEFAULT_RUN_UPLOAD_LIMITS;
  const { directory, uploadId } = await storage.createUploadDirectory();

  return new Promise<RunUpload>((resolve, reject) => {
    const fields: Record<string, string> = {};
    const fastqFiles: { relativePath: string; sizeBytes: number }[] = [];
    const seenPaths = new Set<string>();
    const openStreams = new Set<Readable | Writable>();
    const pending: Promise<void>[] = [];
    let sampleSheet: RunUpload['sampleSheet'] = null;
    let sheetReceived = false;
    let totalBytes = 0;
    let settled = false;
    let parser: busboy.Busboy;

    const fail = (issue: UploadIssue, auditReason: UploadAuditReason | null = null) => {
      if (settled) {
        return;
      }

      settled = true;
      request.unpipe(parser);

      for (const stream of openStreams) {
        stream.destroy();
      }

      void storage
        .removeUpload(uploadId)
        .catch(() => undefined)
        .finally(() => reject(new UploadRejectedError([issue], auditReason)));
    };

    try {
      parser = busboy({
        defParamCharset: 'utf8',
        headers: request.headers,
        limits: {
          fieldSize: TEXT_FIELD_MAX_BYTES,
          fields: TEXT_FIELD_COUNT,
          // One more than the FASTQ limit for the sample sheet.
          files: limits.maxFastqFiles + 1,
          fileSize: limits.maxTotalBytes,
          parts: PARTS_MAX,
        },
        preservePath: true,
      });
    } catch {
      settled = true;
      void storage
        .removeUpload(uploadId)
        .catch(() => undefined)
        .finally(() =>
          reject(
            new UploadRejectedError([{ field: 'files', message: MESSAGES.notMultipart }], null),
          ),
        );
      return;
    }

    const limitExceeded = () =>
      fail(
        {
          field: 'files',
          message: `Upload at most ${limits.maxFastqFiles} FASTQ files and ${formatLimit(limits.maxTotalBytes)} in total.`,
        },
        'LIMIT_EXCEEDED',
      );

    function receiveFastq(stream: Readable, path: string) {
      const layout = fields.layout;

      if (layout === undefined) {
        stream.resume();
        fail({ field: 'layout', message: MESSAGES.fieldsFirst });
        return;
      }

      const depth = RUN_INPUT_LAYOUT_DEPTH[layout as RunInputLayout] as number | undefined;

      if (depth === undefined) {
        stream.resume();
        fail({ field: 'layout', message: MESSAGES.layout });
        return;
      }

      const segments = splitRelativePath(path);

      if (!segments) {
        stream.resume();
        fail({ field: 'files', message: MESSAGES.unsafePath }, 'UNSAFE_PATH');
        return;
      }

      if (segments.length !== depth) {
        stream.resume();
        fail({ field: 'files', message: MESSAGES.depth });
        return;
      }

      if (!isFastqFileName(segments.at(-1) ?? '')) {
        stream.resume();
        fail({ field: 'files', message: MESSAGES.notFastq });
        return;
      }

      if (seenPaths.has(path)) {
        stream.resume();
        fail({ field: 'files', message: MESSAGES.duplicate });
        return;
      }

      if (fastqFiles.length >= limits.maxFastqFiles) {
        stream.resume();
        limitExceeded();
        return;
      }

      seenPaths.add(path);
      const entry = { relativePath: path, sizeBytes: 0 };
      fastqFiles.push(entry);
      const gzip = path.endsWith('.gz');
      let head = Buffer.alloc(0);
      openStreams.add(stream);
      // busboy emits `limit` while parsing, possibly before the stream is read: listen now.
      stream.on('limit', limitExceeded);

      pending.push(
        (async () => {
          let writer: Writable;

          try {
            writer = await storage.createUploadFileStream(directory, `${FASTQ_DIRECTORY}/${path}`);
          } catch (error) {
            stream.resume();
            fail(
              {
                field: 'files',
                message:
                  error instanceof StoragePathError ? MESSAGES.unsafePath : MESSAGES.unreadable,
              },
              error instanceof StoragePathError ? 'UNSAFE_PATH' : null,
            );
            return;
          }

          if (settled) {
            writer.destroy();
            return;
          }

          openStreams.add(writer);
          const written = pipeline(stream, writer);

          stream.on('data', (chunk: Buffer) => {
            if (settled) {
              return;
            }

            entry.sizeBytes += chunk.length;
            totalBytes += chunk.length;

            if (totalBytes > limits.maxTotalBytes) {
              limitExceeded();
              return;
            }

            if (head.length < GZIP_MAGIC.length) {
              head = Buffer.concat([head, chunk.subarray(0, GZIP_MAGIC.length - head.length)]);

              if (!hasValidStart(head, gzip, false)) {
                fail({ field: `file:${path}`, message: MESSAGES.badContent });
              }
            }
          });

          try {
            await written;
          } catch {
            fail({ field: 'files', message: MESSAGES.unreadable });
            return;
          }

          if ((stream as Readable & { truncated?: boolean }).truncated) {
            limitExceeded();
            return;
          }

          if (!hasValidStart(head, gzip, true)) {
            fail({ field: `file:${path}`, message: MESSAGES.badContent });
          }
        })(),
      );
    }

    function receiveSampleSheet(stream: Readable) {
      if (sheetReceived) {
        stream.resume();
        fail({ field: 'sampleSheet', message: MESSAGES.sheetTwice });
        return;
      }

      sheetReceived = true;
      openStreams.add(stream);
      const chunks: Buffer[] = [];
      let size = 0;
      const tooLarge = () =>
        fail(
          {
            field: 'sampleSheet',
            message: `The sample sheet must be ${formatLimit(limits.sampleSheetMaxBytes)} or smaller.`,
          },
          'LIMIT_EXCEEDED',
        );

      pending.push(
        new Promise<void>((done) => {
          stream.on('data', (chunk: Buffer) => {
            if (settled) {
              return;
            }

            size += chunk.length;

            if (size > limits.sampleSheetMaxBytes) {
              tooLarge();
              return;
            }

            chunks.push(chunk);
          });
          stream.on('limit', tooLarge);
          stream.on('end', () => done());
          stream.on('close', () => done());
          stream.on('error', () => done());
        })
          .then(async () => {
            if (settled) {
              return;
            }

            const buffer = Buffer.concat(chunks);
            let content: string;

            try {
              content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            } catch {
              fail({ field: 'sampleSheet', message: MESSAGES.sheetEncoding });
              return;
            }

            await writeFile(resolvePrivateStoragePath(directory, SAMPLE_SHEET_FILE_NAME), buffer, {
              flag: 'wx',
              mode: 0o600,
            });
            sampleSheet = { content, sizeBytes: buffer.length };
          })
          .catch(() => fail({ field: 'sampleSheet', message: MESSAGES.unreadable })),
      );
    }

    parser.on('field', (name, value, info) => {
      if (settled) {
        return;
      }

      if (info.nameTruncated || info.valueTruncated) {
        fail({ field: 'fields', message: MESSAGES.fieldTooLong });
        return;
      }

      if (Object.hasOwn(fields, name)) {
        fail({ field: 'fields', message: MESSAGES.fieldTwice });
        return;
      }

      fields[name] = value;
    });
    parser.on('file', (name, stream, info) => {
      if (settled) {
        stream.resume();
        return;
      }

      if (name === 'fastq') {
        receiveFastq(stream, info.filename ?? '');
      } else if (name === 'sampleSheet') {
        receiveSampleSheet(stream);
      } else {
        stream.resume();
        fail({ field: 'files', message: MESSAGES.unexpectedFile });
      }
    });
    parser.on('filesLimit', limitExceeded);
    parser.on('fieldsLimit', () =>
      fail({ field: 'fields', message: MESSAGES.tooManyParts }, 'LIMIT_EXCEEDED'),
    );
    parser.on('partsLimit', () =>
      fail({ field: 'fields', message: MESSAGES.tooManyParts }, 'LIMIT_EXCEEDED'),
    );
    parser.on('error', () => fail({ field: 'files', message: MESSAGES.unreadable }));
    parser.on('close', () => {
      void Promise.all(pending).then(() => {
        if (settled) {
          return;
        }

        settled = true;
        resolve({ directory, fastqFiles, fields, sampleSheet, uploadId });
      });
    });
    request.on('error', () => fail({ field: 'files', message: MESSAGES.unreadable }));
    request.on('close', () => {
      if (!request.complete) {
        fail({ field: 'files', message: MESSAGES.unreadable });
      }
    });
    request.pipe(parser);
  });
}

/** Gzip files start with 1f 8b; plain FASTQ records start with `@`. */
function hasValidStart(head: Buffer, gzip: boolean, complete: boolean): boolean {
  if (complete && head.length < (gzip ? GZIP_MAGIC.length : 1)) {
    return false;
  }

  if (gzip) {
    return head.every((byte, index) => byte === GZIP_MAGIC[index]);
  }

  return head.length === 0 || head[0] === FASTQ_RECORD_START;
}

function formatLimit(bytes: number): string {
  const GIB = 1_073_741_824;
  const MIB = 1_048_576;
  const KIB = 1024;

  if (bytes >= GIB && bytes % GIB === 0) {
    return `${bytes / GIB} GB`;
  }

  if (bytes >= MIB && bytes % MIB === 0) {
    return `${bytes / MIB} MB`;
  }

  return bytes >= KIB && bytes % KIB === 0 ? `${bytes / KIB} KB` : `${bytes} bytes`;
}
