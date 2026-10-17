import { isAbsolute, relative, resolve, sep } from 'node:path';

export class StoragePathError extends Error {
  public constructor() {
    super('Storage key resolves outside the configured private storage root.');
    this.name = 'StoragePathError';
  }
}

export function resolvePrivateStoragePath(storageRoot: string, storageKey: string): string {
  const resolvedRoot = resolve(storageRoot);
  const resolvedPath = resolve(resolvedRoot, storageKey);
  const relativePath = relative(resolvedRoot, resolvedPath);

  // `relative` returns an absolute path when the target is on another drive (Windows `A:`).
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new StoragePathError();
  }

  return resolvedPath;
}
