import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Raw `multipart/form-data` builder for launch tests. Built by hand (not SuperTest `attach`)
 * so file names such as `../x.fastq` or `run/barcode01/a.fastq.gz` reach the server exactly as
 * written — form-data would normalise or strip the directory part.
 */
export type MultipartPart =
  | { name: string; value: string }
  | { name: string; filename: string; content: Buffer | string; contentType?: string };

export function buildMultipart(parts: readonly MultipartPart[]): {
  body: Buffer;
  contentType: string;
} {
  const { chunks, contentType } = buildMultipartChunks(parts);
  return { body: Buffer.concat(chunks), contentType };
}

/**
 * The same body split into one chunk per part (the closing boundary is appended to the last
 * chunk), so a test can stream the parts one at a time like a browser upload does.
 */
export function buildMultipartChunks(parts: readonly MultipartPart[]): {
  chunks: Buffer[];
  contentType: string;
} {
  const boundary = `----portal-test-${randomBytes(12).toString('hex')}`;
  const chunks = parts.map((part) =>
    'value' in part
      ? Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
        )
      : Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`,
          ),
          Buffer.isBuffer(part.content) ? part.content : Buffer.from(part.content),
          Buffer.from('\r\n'),
        ]),
  );
  const closing = Buffer.from(`--${boundary}--\r\n`);
  const last = chunks.pop();
  chunks.push(last ? Buffer.concat([last, closing]) : closing);

  return { chunks, contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Resolves once `uploads/<id>/fastq/<relativePath>` exists under `storageRoot`, i.e. the
 * receiver has opened that file's write stream. Used to pace uploads part by part (BUG-1).
 */
export async function waitForStagedFile(
  storageRoot: string,
  relativePath: string,
  timeoutMs = 5000,
): Promise<boolean> {
  const uploads = join(storageRoot, 'uploads');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const ids = await readdir(uploads).catch(() => [] as string[]);

    if (ids.some((id) => existsSync(join(uploads, id, 'fastq', relativePath)))) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  return false;
}

/** Synthetic FASTQ records (random bases, constant quality); never real sequencing data. */
export function syntheticFastq(reads = 2, length = 16): string {
  const bases = 'ACGT';
  let text = '';

  for (let index = 0; index < reads; index += 1) {
    const sequence = Array.from(
      randomBytes(length),
      (byte) => bases[byte % bases.length] ?? 'A',
    ).join('');
    text += `@synthetic_read_${index}\n${sequence}\n+\n${'I'.repeat(length)}\n`;
  }

  return text;
}

export function syntheticFastqGz(reads = 2, length = 16): Buffer {
  return gzipSync(syntheticFastq(reads, length));
}

export type LaunchSpec = {
  runName?: string;
  layout: 'SINGLE_FILE' | 'SAMPLE_FOLDER' | 'BARCODE_FOLDERS';
  sampleName?: string;
  options?: Record<string, unknown>;
  sampleSheet?: string;
  /** Relative path → content (defaults to a synthetic gzip FASTQ). */
  files: readonly (string | { path: string; content: Buffer | string })[];
};

/** Launch body in the order the browser sends it: fields, sample sheet, then FASTQ files. */
export function launchParts(spec: LaunchSpec): MultipartPart[] {
  const parts: MultipartPart[] = [
    { name: 'runName', value: spec.runName ?? 'Synthetic run' },
    { name: 'layout', value: spec.layout },
  ];

  if (spec.sampleName) {
    parts.push({ name: 'sampleName', value: spec.sampleName });
  }

  parts.push({ name: 'options', value: JSON.stringify(spec.options ?? {}) });

  if (spec.sampleSheet !== undefined) {
    parts.push({ content: spec.sampleSheet, filename: 'sample_sheet.csv', name: 'sampleSheet' });
  }

  for (const file of spec.files) {
    const entry =
      typeof file === 'string'
        ? { content: file.endsWith('.gz') ? syntheticFastqGz() : syntheticFastq(), path: file }
        : file;
    parts.push({ content: entry.content, filename: entry.path, name: 'fastq' });
  }

  return parts;
}
