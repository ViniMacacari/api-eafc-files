import { EaFileError } from '../../domain/errors.js';
import type { DecodeBudget } from '../../domain/limits.js';
import type { EaDatabase, EaWarning } from '../../domain/models.js';
import type { IndexedTable } from '../metadata/schema-index.js';
import { BinaryReader } from './binary-reader.js';
import { parseTable } from './table-parser.js';

const signature = [0x44, 0x42, 0x00, 0x08];

export function hasDatabaseSignature(bytes: Uint8Array, offset: number): boolean {
  return offset + 4 <= bytes.length && signature.every((byte, i) => bytes[offset + i] === byte);
}

export function findDatabase(bytes: Uint8Array, start: number): number {
  for (let offset = start; offset <= bytes.length - 4; offset++) {
    if (bytes[offset] === 0x44 && hasDatabaseSignature(bytes, offset)) return offset;
  }
  return -1;
}

export function parseDatabase(bytes: Uint8Array, start: number, index: number,
  metadata: ReadonlyMap<string, IndexedTable>, budget: DecodeBudget, warnings: EaWarning[], selectedTables?: ReadonlySet<string>): EaDatabase {
  const fileReader = new BinaryReader(bytes);
  fileReader.ensure(start, 28);
  const platformFlag = fileReader.u8(start + 4);
  if (!hasDatabaseSignature(bytes, start) || platformFlag > 1 ||
      fileReader.u8(start + 5) !== 0 || fileReader.u8(start + 6) !== 0 || fileReader.u8(start + 7) !== 0) {
    throw new EaFileError('INVALID_FORMAT', 'Invalid DB database signature.', start);
  }
  const endianness = platformFlag === 0 ? 'little' : 'big';
  const headerReader = new BinaryReader(bytes, endianness);
  const byteLength = headerReader.i32(start + 8);
  if (byteLength < 28) throw new EaFileError('INVALID_FORMAT', 'Invalid DB database length.', start + 8);
  headerReader.ensure(start, byteLength);
  const reader = new BinaryReader(bytes, endianness, start, start + byteLength);
  const tableCount = reader.i32(start + 16);
  if (tableCount < 0) throw new EaFileError('INVALID_FORMAT', 'Negative table count.', start + 16);
  if (tableCount > budget.limits.maxTablesPerDatabase) throw new EaFileError('LIMIT_EXCEEDED', 'Table limit per database exceeded.', start + 16);
  reader.ensure(start + 24, tableCount * 8 + 4);
  const tablesBase = start + 28 + tableCount * 8;
  const entries: { shortName: string; offset: number }[] = [];
  const names = new Set<string>();
  for (let i = 0; i < tableCount; i++) {
    const entry = start + 24 + i * 8;
    const shortName = reader.text(entry, 4);
    const offset = tablesBase + reader.u32(entry + 4);
    reader.ensure(offset, 36);
    if (names.has(shortName)) throw new EaFileError('INVALID_FORMAT', `Duplicate table: ${shortName}.`, entry);
    names.add(shortName);
    entries.push({ shortName, offset });
  }
  const sortedOffsets = entries.map((entry) => entry.offset).sort((a, b) => a - b);
  const ends = new Map<number, number>();
  for (let i = 0; i < sortedOffsets.length; i++) {
    const offset = sortedOffsets[i]!;
    const end = sortedOffsets[i + 1] ?? reader.end;
    if (offset + 36 > end) throw new EaFileError('INVALID_FORMAT', 'Overlapping tables in the DB directory.', offset);
    ends.set(offset, end);
  }
  const selected = selectedTables === undefined ? entries : entries.filter((entry) =>
    selectedTables.has(entry.shortName) || selectedTables.has(metadata.get(entry.shortName)?.definition.name ?? entry.shortName));
  const tables = selected.map((entry) => parseTable(bytes, endianness, entry.shortName, entry.offset,
    ends.get(entry.offset)!, metadata.get(entry.shortName), budget, warnings));
  return { index, offset: start, byteLength, endianness, platform: platformFlag === 0 ? 'pc' : 'xbox',
    headerCrc: reader.u32(start + 20), directoryCrc: reader.u32(tablesBase - 4), tableCount, tables };
}
