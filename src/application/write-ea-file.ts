import { resolve } from 'node:path';
import { EaFileError } from '../domain/errors.js';
import { resolveLimits } from '../domain/limits.js';
import type { EaFile } from '../domain/models.js';
import type { WriteFileOptions, WriteFileResult } from '../domain/write-models.js';
import { atomicWriteFile } from '../infrastructure/filesystem/atomic-write-file.js';
import { readOnlyFile } from '../infrastructure/filesystem/read-only-file.js';
import { serializeEaFile } from './serialize-ea-file.js';

export async function writeEaFile(sourcePath: string, outputPath: string, file: EaFile,
  options: WriteFileOptions = {}): Promise<WriteFileResult> {
  if (typeof sourcePath !== 'string' || !sourcePath || typeof outputPath !== 'string' || !outputPath ||
      (options.overwrite !== undefined && typeof options.overwrite !== 'boolean')) {
    throw new EaFileError('INVALID_OPTIONS', 'Source and output paths must be nonempty strings; overwrite must be a boolean.');
  }
  const limits = resolveLimits(options.limits);
  const bytes = await readOnlyFile(sourcePath, limits.maxFileBytes);
  const encoded = serializeEaFile(bytes, file, options);
  const path = resolve(outputPath);
  await atomicWriteFile(path, encoded, options.overwrite ?? false);
  return { path, byteLength: encoded.length };
}
