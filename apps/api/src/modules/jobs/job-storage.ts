import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { jobIdSchema } from '@portal/shared';

import { resolvePrivateStoragePath } from '../../infrastructure/storage-path.js';

export const INPUT_FILE_NAME = 'input.csv';
export const RESULT_FILE_NAME = 'result.json';
const JOBS_DIRECTORY = 'jobs';
const UPLOADS_DIRECTORY = 'uploads';
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type JobSubdirectory = 'input' | 'run' | 'output';

export class InvalidJobIdError extends Error {
  public constructor() {
    super('Invalid job identifier.');
    this.name = 'InvalidJobIdError';
  }
}

export type JobStorage = ReturnType<typeof createJobStorage>;

/**
 * The only code that touches job files (design C3). Paths are built from server-generated job
 * IDs and fixed file names — never from client-supplied names — and are confined to the root.
 */
export function createJobStorage(storageRoot: string) {
  function jobDirectory(jobId: string): string {
    if (!jobIdSchema.safeParse(jobId).success) {
      throw new InvalidJobIdError();
    }

    return resolvePrivateStoragePath(storageRoot, `${JOBS_DIRECTORY}/${jobId}`);
  }

  function jobFile(jobId: string, fileName: string): string {
    return resolvePrivateStoragePath(jobDirectory(jobId), fileName);
  }

  /** Relative key stored in the database; never an absolute path. */
  function storageKey(jobId: string, fileName: string): string {
    jobDirectory(jobId);
    return `${JOBS_DIRECTORY}/${jobId}/${fileName}`;
  }

  async function writeJobFile(jobId: string, fileName: string, content: string): Promise<void> {
    await mkdir(jobDirectory(jobId), { mode: 0o700, recursive: true });
    await writeFile(jobFile(jobId, fileName), content, { encoding: 'utf8', mode: 0o600 });
  }

  /** `jobs/{jobId}/input|run|output` of a Nextflow job. */
  function jobSubdirectory(jobId: string, name: JobSubdirectory): string {
    return resolvePrivateStoragePath(jobDirectory(jobId), name);
  }

  function uploadDirectory(uploadId: string): string {
    if (!UPLOAD_ID_PATTERN.test(uploadId)) {
      throw new InvalidJobIdError();
    }

    return resolvePrivateStoragePath(storageRoot, `${UPLOADS_DIRECTORY}/${uploadId}`);
  }

  /** Creates `uploads/{uploadId}/` (0700) for one streaming upload. */
  async function createUploadDirectory(): Promise<{ uploadId: string; directory: string }> {
    const uploadId = randomUUID();
    await mkdir(resolvePrivateStoragePath(storageRoot, UPLOADS_DIRECTORY), {
      mode: 0o700,
      recursive: true,
    });
    const directory = uploadDirectory(uploadId);
    await mkdir(directory, { mode: 0o700 });

    return { directory, uploadId };
  }

  /** Opens a new file (exclusive create, 0600) at a path already confined by the caller. */
  async function createUploadFileStream(directory: string, relativePath: string) {
    const target = resolvePrivateStoragePath(directory, relativePath);
    await mkdir(dirname(target), { mode: 0o700, recursive: true });

    return createWriteStream(target, { flags: 'wx', mode: 0o600 });
  }

  /** Moves a finished upload to `jobs/{jobId}/input` (same file system, atomic rename). */
  async function moveUploadToJobInput(uploadId: string, jobId: string): Promise<void> {
    await mkdir(jobDirectory(jobId), { mode: 0o700, recursive: true });
    await rename(uploadDirectory(uploadId), jobSubdirectory(jobId, 'input'));
  }

  return {
    jobDirectory,
    jobFile,
    jobSubdirectory,
    storageKey,
    uploadDirectory,
    createUploadDirectory,
    createUploadFileStream,
    moveUploadToJobInput,
    removeUpload: (uploadId: string) =>
      rm(uploadDirectory(uploadId), { force: true, recursive: true }),
    writeInput: (jobId: string, content: string) => writeJobFile(jobId, INPUT_FILE_NAME, content),
    readInput: (jobId: string) => readFile(jobFile(jobId, INPUT_FILE_NAME), 'utf8'),
    writeResult: (jobId: string, content: string) => writeJobFile(jobId, RESULT_FILE_NAME, content),
    writeJobFile,
    removeJob: (jobId: string) => rm(jobDirectory(jobId), { force: true, recursive: true }),
    /** Job IDs that have a directory on disk (used to find orphans after failed deletions). */
    async listJobIds(): Promise<string[]> {
      try {
        const entries = await readdir(resolvePrivateStoragePath(storageRoot, JOBS_DIRECTORY), {
          withFileTypes: true,
        });
        return entries
          .filter((entry) => entry.isDirectory() && jobIdSchema.safeParse(entry.name).success)
          .map((entry) => entry.name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }

        throw error;
      }
    },
    /** Confirms the storage root accepts writes (used by executor readiness). */
    async checkWritable(): Promise<boolean> {
      const probe = resolvePrivateStoragePath(storageRoot, `${JOBS_DIRECTORY}/.ready`);

      try {
        await mkdir(resolvePrivateStoragePath(storageRoot, JOBS_DIRECTORY), {
          mode: 0o700,
          recursive: true,
        });
        await writeFile(probe, 'ok', { mode: 0o600 });
        await rm(probe, { force: true });
        return true;
      } catch {
        return false;
      }
    },
  };
}
