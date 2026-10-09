import { DEFAULT_LIMITS, resolveLimits } from '../domain/limits.js';
import type { MetadataSchema } from '../domain/models.js';
import type { EaFcVersion, TemplateDatabase } from '../domain/templates.js';
import { readOnlyFile } from '../infrastructure/filesystem/read-only-file.js';
import { parseMetadataXml } from '../infrastructure/metadata/xml-metadata.js';
import { resolveTemplateFiles } from '../infrastructure/templates/template-files.js';

export async function loadTemplateMetadata(version: EaFcVersion, database: TemplateDatabase = 'main',
  maxFileBytes: number = DEFAULT_LIMITS.maxFileBytes): Promise<MetadataSchema> {
  const { xmlPath } = resolveTemplateFiles(version, database);
  const limits = resolveLimits({ maxFileBytes });
  const bytes = await readOnlyFile(xmlPath, limits.maxFileBytes);
  return parseMetadataXml(new TextDecoder('utf-8').decode(bytes));
}
