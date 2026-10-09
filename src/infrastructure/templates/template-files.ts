import { fileURLToPath } from 'node:url';
import { EaFileError } from '../../domain/errors.js';
import { SUPPORTED_VERSIONS, TEMPLATE_DATABASES } from '../../domain/templates.js';
import type { EaFcVersion, TemplateDatabase } from '../../domain/templates.js';

const files: Readonly<Record<TemplateDatabase, { database: string; metadata: string }>> = {
  main: { database: 'fifa_ng_db.db', metadata: 'fifa_ng_db-meta.xml' },
  fut: { database: 'FUT/cards_ng_db.db', metadata: 'FUT/cards_ng_db-meta.xml' },
  localization: { database: 'loc/eng_us.db', metadata: 'loc/eng_us-meta.xml' },
};

export function resolveTemplateFiles(version: EaFcVersion, database: TemplateDatabase = 'main'): {
  databasePath: string;
  xmlPath: string;
} {
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new EaFileError('INVALID_OPTIONS', `Invalid version. Available versions: ${SUPPORTED_VERSIONS.join(', ')}.`);
  }
  if (!TEMPLATE_DATABASES.includes(database)) {
    throw new EaFileError('INVALID_OPTIONS', `Invalid database. Available databases: ${TEMPLATE_DATABASES.join(', ')}.`);
  }
  const root = new URL(`../../../templates/${encodeURIComponent(version)}/`, import.meta.url);
  const selected = files[database];
  return { databasePath: fileURLToPath(new URL(selected.database, root)),
    xmlPath: fileURLToPath(new URL(selected.metadata, root)) };
}
