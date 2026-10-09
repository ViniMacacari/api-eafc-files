import { EaFileError } from '../../domain/errors.js';
import type { MetadataField, MetadataSchema, MetadataTable } from '../../domain/models.js';

export interface IndexedTable {
  readonly definition: MetadataTable;
  readonly fields: ReadonlyMap<string, MetadataField>;
}

export function indexMetadata(schema?: MetadataSchema): ReadonlyMap<string, IndexedTable> {
  const tables = new Map<string, IndexedTable>();
  if (schema === undefined) return tables;
  if (!Array.isArray(schema.tables)) throw new EaFileError('INVALID_METADATA', 'metadata.tables must be an array.');
  for (const table of schema.tables) {
    validateName(table.shortName, table.name);
    if (tables.has(table.shortName) || !Array.isArray(table.fields)) {
      throw new EaFileError('INVALID_METADATA', `Duplicate table or invalid fields: ${table.shortName}.`);
    }
    const fields = new Map<string, MetadataField>();
    const names = new Set<string>();
    for (const field of table.fields) {
      validateName(field.shortName, field.name);
      if (fields.has(field.shortName) || names.has(field.name) || !isInt32(field.rangeLow) ||
          (field.rangeHigh !== null && (!isInt32(field.rangeHigh) || field.rangeHigh < field.rangeLow))) {
        throw new EaFileError('INVALID_METADATA', `Duplicate field or invalid range: ${table.shortName}.${field.shortName}.`);
      }
      fields.set(field.shortName, field);
      names.add(field.name);
    }
    tables.set(table.shortName, { definition: table, fields });
  }
  return tables;
}

function validateName(shortName: string, name: string): void {
  if (typeof shortName !== 'string' || !/^[\x20-\x7e]{4}$/.test(shortName) ||
      typeof name !== 'string' || name.trim().length === 0) {
    throw new EaFileError('INVALID_METADATA', 'Metadata requires a four-byte ASCII shortname and a nonempty name.');
  }
}

function isInt32(value: number): boolean {
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}
