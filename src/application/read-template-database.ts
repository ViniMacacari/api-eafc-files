import type { EaFile, ReadTemplateOptions } from '../domain/models.js';
import { resolveTemplateFiles } from '../infrastructure/templates/template-files.js';
import { readEaFile } from './read-ea-file.js';

export async function readTemplateDatabase(options: ReadTemplateOptions): Promise<EaFile> {
  const { databasePath } = resolveTemplateFiles(options.version, options.database);
  return readEaFile(databasePath, options);
}
