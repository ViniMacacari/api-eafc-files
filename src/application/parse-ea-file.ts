import { EaFileError } from '../domain/errors.js';
import { DecodeBudget, resolveLimits } from '../domain/limits.js';
import type { EaDatabase, EaFile, EaWarning, FileKind, ParseOptions } from '../domain/models.js';
import { findDatabase, hasDatabaseSignature, parseDatabase } from '../infrastructure/binary/database-parser.js';
import { indexMetadata } from '../infrastructure/metadata/schema-index.js';

export function parseEaFile(bytes: Uint8Array, options: ParseOptions = {}): EaFile {
  const limits = resolveLimits(options.limits);
  if (bytes.byteLength > limits.maxFileBytes) throw new EaFileError('LIMIT_EXCEEDED', 'File exceeds maxFileBytes.');
  const metadata = indexMetadata(options.metadata);
  if (options.tables !== undefined && (!Array.isArray(options.tables) || options.tables.length === 0 ||
      options.tables.some((name) => typeof name !== 'string' || name.length === 0))) {
    throw new EaFileError('INVALID_OPTIONS', 'tables must be a nonempty array of table names.');
  }
  const selectedTables = options.tables === undefined ? undefined : new Set(options.tables);
  const budget = new DecodeBudget(limits);
  const warnings: EaWarning[] = [];
  const databases: EaDatabase[] = [];
  const standalone = hasDatabaseSignature(bytes, 0);
  let inGameName: string | null = null;
  let cursor = 0;
  if (!standalone) {
    if (bytes.byteLength <= 18) throw new EaFileError('TRUNCATED_FILE', 'Save is missing its header or internal name.', 18);
    const zero = bytes.indexOf(0, 18);
    if (zero === -1 || zero - 18 >= 256) throw new EaFileError('INVALID_FORMAT', 'Internal name is missing or exceeds 255 bytes.', 18);
    inGameName = Array.from(bytes.subarray(18, zero), (byte) => String.fromCharCode(byte)).join('');
    cursor = zero + 1;
  }
  while (cursor < bytes.length) {
    const offset = findDatabase(bytes, cursor);
    if (offset === -1) break;
    if (databases.length >= limits.maxDatabases) throw new EaFileError('LIMIT_EXCEEDED', 'Database limit per file exceeded.', offset);
    const database = parseDatabase(bytes, offset, databases.length, metadata, budget, warnings, selectedTables);
    databases.push(database);
    cursor = offset + database.byteLength;
    if (standalone) break;
  }
  if (databases.length === 0) throw new EaFileError('INVALID_FORMAT', 'No supported DB database was found.');
  return { formatVersion: 1, source: { fileName: options.fileName ?? null, byteLength: bytes.byteLength,
    kind: options.kind ?? detectKind(options.fileName, standalone) }, container: standalone ? 'database' : 'ea-save',
    inGameName, metadataComplete: databases.every((db) => db.tables.every((table) => table.metadataComplete)), databases, warnings };
}

function detectKind(fileName: string | undefined, standalone: boolean): FileKind {
  if (standalone) return 'database';
  const name = fileName?.split(/[\\/]/).at(-1) ?? '';
  if (/^(Squad|FutSquads|WomenWocSquads|WocSquads|Euro24Squads)/i.test(name) || /\.squads?$/i.test(name)) return 'squad';
  if (/^(Career|ManagerCareer|PlayerCareer|CmMgrC|CmPlr)/i.test(name) || /\.career$/i.test(name)) return 'career';
  return 'unknown';
}
