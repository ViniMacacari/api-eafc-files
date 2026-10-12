import { basename } from 'node:path';
import type { CareerData, CareerParseOptions } from '../domain/career-models.js';
import { resolveLimits } from '../domain/limits.js';
import { readOnlyFile } from '../infrastructure/filesystem/read-only-file.js';
import { parseCareerData } from './parse-career-data.js';

export async function readCareerData(path: string, options: CareerParseOptions = {}): Promise<CareerData> {
  const bytes = await readOnlyFile(path, resolveLimits(options.limits).maxFileBytes);
  return parseCareerData(bytes, { ...options, fileName: options.fileName ?? basename(path) });
}
