import { relative, resolve, sep } from 'node:path';

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

  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new StoragePathError();
  }

  return resolvedPath;
}
