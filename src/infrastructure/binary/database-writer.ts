import { EaFileError } from '../../domain/errors.js';
import type { DecodeBudget } from '../../domain/limits.js';
import type { EaDatabase } from '../../domain/models.js';
import { BinaryReader } from './binary-reader.js';
import { BinaryWriter } from './binary-writer.js';
import { databaseCrc } from './crc.js';
import { encodeTable, reserveUnchangedTable, tableChanged, validateTableSchema } from './table-writer.js';

export function encodeDatabase(sourceBytes: Uint8Array, database: EaDatabase, original: EaDatabase,
  fixedSize: boolean, budget: DecodeBudget): Uint8Array | undefined {
  for (const key of ['index', 'offset', 'byteLength', 'endianness', 'platform', 'tableCount'] as const) {
    if (database[key] !== original[key]) throw new EaFileError('INVALID_WRITE', `Database structure cannot be changed: ${key}.`);
  }
  const reader = new BinaryReader(sourceBytes, original.endianness, original.offset, original.offset + original.byteLength);
  const base = original.offset + 28 + original.tableCount * 8;
  const entries = Array.from({ length: original.tableCount }, (_, index) => ({
    index, shortName: reader.text(original.offset + 24 + index * 8, 4),
    offset: base + reader.u32(original.offset + 28 + index * 8),
  })).sort((a, b) => a.offset - b.offset);
  const requested = new Map(database.tables.map(table => [table.shortName, table]));
  if (requested.size !== database.tables.length) throw new EaFileError('INVALID_WRITE', 'Duplicate tables cannot be written.');
  const sources = new Map(original.tables.map(table => [table.shortName, table]));
  const changed = new Map<string, Uint8Array>();
  for (const table of database.tables) {
    const source = sources.get(table.shortName);
    if (source === undefined) throw new EaFileError('INVALID_WRITE', `Table is not present in the source database: ${table.shortName}.`);
    validateTableSchema(table, source);
    if (tableChanged(table, source)) changed.set(table.shortName, encodeTable(sourceBytes, table, source, original.endianness, budget));
    else reserveUnchangedTable(sourceBytes, source, original.endianness, budget);
  }
  if (changed.size === 0) return undefined;
  const prefixLength = (entries[0]?.offset ?? base) - original.offset;
  const parts = entries.map((entry, index) => changed.get(entry.shortName) ??
    sourceBytes.subarray(entry.offset, entries[index + 1]?.offset ?? reader.end));
  let length = prefixLength + parts.reduce((sum, part) => sum + part.length, 0);
  if (fixedSize && length > original.byteLength) {
    throw new EaFileError('INVALID_WRITE', `Database ${original.index} needs ${length} bytes but its save allocation is ${original.byteLength} bytes.`);
  }
  if (fixedSize) length = original.byteLength;
  if (length > budget.limits.maxFileBytes || length > 2147483647) throw new EaFileError('LIMIT_EXCEEDED', 'Encoded database exceeds its size limit.');
  const bytes = new Uint8Array(length);
  bytes.set(sourceBytes.subarray(original.offset, original.offset + prefixLength));
  const writer = new BinaryWriter(bytes, original.endianness);
  writer.i32(8, length);
  let offset = prefixLength;
  for (const [index, entry] of entries.entries()) {
    const part = parts[index]!;
    const sourceEnd = entries[index + 1]?.offset ?? reader.end;
    const sourceBodyEnd = entry.offset + 36 + reader.u8(entry.offset + 24) * 16 +
      reader.u16(entry.offset + 18) * reader.i32(entry.offset + 4) +
      (reader.u16(entry.offset + 16) > 0 ? reader.u32(entry.offset + 12) : 0);
    if (part.length < 40 || sourceBodyEnd > sourceEnd - 4) throw new EaFileError('INVALID_WRITE', 'Table is missing its record CRC.');
    const end = index === entries.length - 1 ? length : offset + part.length;
    bytes.set(part, offset);
    if (end > offset + part.length) bytes.fill(0, offset + part.length - 4, end - 4);
    writer.u32(28 + entry.index * 8, offset - (base - original.offset));
    writer.u32(offset + 32, databaseCrc(bytes.subarray(offset, offset + 32)));
    writer.u32(end - 4, databaseCrc(bytes.subarray(offset + 36, end - 4)));
    offset = end;
  }
  writer.u32(20, databaseCrc(bytes.subarray(0, 20)));
  writer.u32(24 + original.tableCount * 8, databaseCrc(bytes.subarray(24, 24 + original.tableCount * 8)));
  return bytes;
}
