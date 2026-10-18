import { constants } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

import type { Response } from 'express';

import { GoneError } from '../../http/errors.js';
import type { ActorContext } from '../../shared/authorization.js';
import type { AuditService } from '../audit/audit.service.js';
import { DOWNLOAD_CONTENT_SECURITY_POLICY, VIEW_CONTENT_SECURITY_POLICY } from './report-policy.js';
import { ArtifactNotFoundError, type ResolvedArtifact } from './result.service.js';

const OCTET_STREAM = 'application/octet-stream';
/** Download content types (design C6); `.html` and everything else are `octet-stream`. */
const DOWNLOAD_CONTENT_TYPES: readonly [string, string][] = [
  ['.json', 'application/json'],
  ['.tsv', 'text/tab-separated-values'],
  ['.csv', 'text/csv'],
  ['.gz', 'application/gzip'],
  ['.yml', 'text/plain'],
  ['.yaml', 'text/plain'],
];
// CR/LF, quotes, path separators and other control characters never reach a header.
const UNSAFE_FILENAME_CHARACTERS = /[\u0000-\u001f\u007f"\\/]/g;
const NON_ASCII_CHARACTERS = /[^\u0020-\u007e]/g;

/** Download name: basename of `displayName` without unsafe characters; never empty. */
export function sanitizeFileName(displayName: string, artifactId: string): string {
  const baseName = displayName.split(/[/\\]/).at(-1) ?? '';
  const cleaned = baseName.replace(UNSAFE_FILENAME_CHARACTERS, '').trim();

  return cleaned.length > 0 && !/^\.+$/.test(cleaned) ? cleaned : `result-${artifactId.slice(-8)}`;
}

/** `attachment|inline; filename="<ascii>"; filename*=UTF-8''<encoded>` (RFC 6266 / 5987). */
export function contentDisposition(
  type: 'attachment' | 'inline',
  fileName: string,
  options: { extended: boolean },
): string {
  const ascii = fileName.replace(NON_ASCII_CHARACTERS, '_');
  const header = `${type}; filename="${ascii}"`;

  return options.extended ? `${header}; filename*=UTF-8''${_encodeRfc5987(fileName)}` : header;
}

/** Content type of a download from its file name (allowlist only). */
export function downloadContentType(fileName: string): string {
  const lower = fileName.toLowerCase();

  return (
    DOWNLOAD_CONTENT_TYPES.find(([extension]) => lower.endsWith(extension))?.[1] ?? OCTET_STREAM
  );
}

/**
 * `GET …/artifacts/{id}/download` (design C6, US-011): always an attachment with an allowlisted
 * content type, `nosniff` and a sandbox CSP. The audit event is written once the file is open
 * (an authorized download that started), before any byte is sent.
 */
export async function sendDownload(
  response: Response,
  artifact: ResolvedArtifact,
  context: { actor: ActorContext; audit: AuditService; requestId: string },
): Promise<void> {
  const fileName = sanitizeFileName(artifact.displayName, artifact.id);
  const { handle, size } = await _openRegularFile(artifact.absolutePath);

  try {
    await context.audit.recordSafely({
      actorId: context.actor.userId,
      eventType: 'RESULT_DOWNLOADED',
      metadata: { artifactId: artifact.id },
      outcome: 'SUCCESS',
      requestId: context.requestId,
      resourceId: artifact.id,
      resourceType: 'RESULT',
    });
    response.status(200);
    response.setHeader(
      'Content-Disposition',
      contentDisposition('attachment', fileName, { extended: true }),
    );
    response.setHeader('Content-Type', downloadContentType(fileName));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', DOWNLOAD_CONTENT_SECURITY_POLICY);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Length', String(size));
    await _stream(handle, response);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * `GET …/artifacts/{id}/view` (design C6, US-009 AC5): allowlisted HTML reports only, sent
 * byte-for-byte with a CSP that sandboxes the document (opaque origin) and blocks the network.
 * Not audited (read-only view, design C6).
 */
export async function sendView(response: Response, artifact: ResolvedArtifact): Promise<void> {
  if (!artifact.viewable) {
    throw new ArtifactNotFoundError();
  }

  const fileName = sanitizeFileName(artifact.displayName, artifact.id);
  const { handle, size } = await _openRegularFile(artifact.absolutePath);

  try {
    response.status(200);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      contentDisposition('inline', fileName, { extended: false }),
    );
    response.setHeader('Content-Security-Policy', VIEW_CONTENT_SECURITY_POLICY);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Length', String(size));
    await _stream(handle, response);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Opens a regular file without following symlinks (lstat + `O_NOFOLLOW`, then `fstat` on the
 * open descriptor). A missing or replaced file is `410 GONE` (retention, US-011 AC4); the
 * underlying error, which carries the absolute path, is never rethrown.
 */
async function _openRegularFile(path: string): Promise<{ handle: FileHandle; size: number }> {
  let handle: FileHandle | null = null;

  try {
    if (!(await lstat(path)).isFile()) {
      throw new GoneError();
    }

    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await handle.stat();

    if (!stats.isFile()) {
      throw new GoneError();
    }

    return { handle, size: stats.size };
  } catch {
    await handle?.close().catch(() => undefined);
    throw new GoneError();
  }
}

/** Streams the open file; a failure after the headers were sent ends the response. */
async function _stream(handle: FileHandle, response: Response): Promise<void> {
  try {
    await pipeline(handle.createReadStream({ autoClose: false }), response);
  } catch {
    // Client aborted or the read failed mid-stream: nothing safe can be sent any more.
    response.destroy();
  }
}

/** RFC 5987 `attr-char` encoding (encodeURIComponent leaves `'()*` unescaped). */
function _encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
