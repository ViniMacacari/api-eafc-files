import { EaFileError } from '../../domain/errors.js';
import type { DecodeBudget } from '../../domain/limits.js';
import type { EaField, EaRecord, EaTable, EaWarning, Endianness, FieldType } from '../../domain/models.js';
import type { IndexedTable } from '../metadata/schema-index.js';
import { BinaryReader } from './binary-reader.js';
import { HuffmanDecoder } from './huffman.js';

const fieldTypes = new Map<number, FieldType>([
  [0, 'string'], [3, 'integer'], [4, 'float'],
  [13, 'short-compressed-string'], [14, 'long-compressed-string'],
]);

export function parseTable(bytes: Uint8Array, endian: Endianness, shortName: string, start: number,
  end: number, metadata: IndexedTable | undefined, budget: DecodeBudget, warnings: EaWarning[]): EaTable {
  const reader = new BinaryReader(bytes, endian, start, end);
  reader.ensure(start, 36);
  const recordSize = reader.i32(start + 4);
  const recordBitLimit = reader.u32(start + 8);
  const compressedStringBytes = reader.u32(start + 12);
  const capacity = reader.u16(start + 16);
  const writtenRecords = reader.u16(start + 18);
  const cancelledRecords = reader.u16(start + 20);
  const fieldCount = reader.u8(start + 24);
  if (recordSize < 0 || (capacity > 0 && recordSize === 0) || writtenRecords > capacity || cancelledRecords > writtenRecords) {
    throw new EaFileError('INVALID_FORMAT', `Invalid table header: ${shortName}.`, start);
  }
  reader.ensure(start + 36, fieldCount * 16);
  budget.addRecords(writtenRecords, fieldCount, start);
  const fields = parseFields(reader, start + 36, fieldCount, recordSize, metadata);
  const recordsStart = start + 36 + fieldCount * 16;
  reader.ensure(recordsStart, writtenRecords * recordSize);
  const stringsStart = recordsStart + writtenRecords * recordSize;
  if (capacity > 0) reader.ensure(stringsStart, compressedStringBytes);
  const compressedFields = fields.filter((field) => field.typeCode === 13 || field.typeCode === 14);
  let treeSize = Infinity;
  let invalidRecords = 0;
  const validOffsets: number[] = [];
  for (let row = 0; row < writtenRecords; row++) {
    const offset = recordsStart + row * recordSize;
    const invalid = (reader.u8(offset + recordSize - 1) & 0x80) !== 0;
    if (invalid) invalidRecords++; else validOffsets.push(offset);
    for (const field of compressedFields) {
      const pointer = reader.i32(offset + field.bitOffset / 8);
      if (pointer < -1 || pointer >= compressedStringBytes) {
        throw new EaFileError('INVALID_COMPRESSED_STRING', `Invalid pointer in ${shortName}.${field.shortName}.`, offset + field.bitOffset / 8);
      }
      if (pointer !== -1) treeSize = Math.min(treeSize, pointer);
    }
  }
  const decoder = Number.isFinite(treeSize)
    ? new HuffmanDecoder(reader, stringsStart, compressedStringBytes, treeSize, budget, endian === 'big')
    : undefined;
  let hasNonFiniteFloat = false;
  const template: EaRecord = Object.fromEntries(fields.map((field) => [field.name, null]));
  const records: EaRecord[] = validOffsets.map((offset) => {
    const result: EaRecord = { ...template };
    for (const field of fields) {
      const fieldOffset = offset + Math.floor(field.bitOffset / 8);
      switch (field.type) {
        case 'integer':
          result[field.name] = reader.integer(offset, field.bitOffset, field.depth, field.rangeLow ?? 0);
          break;
        case 'float': {
          const value = reader.f32(fieldOffset);
          result[field.name] = Number.isFinite(value) ? value : null;
          hasNonFiniteFloat ||= !Number.isFinite(value);
          break;
        }
        case 'string':
          budget.addString(field.depth / 8, fieldOffset);
          result[field.name] = reader.text(fieldOffset, field.depth / 8, true);
          break;
        case 'short-compressed-string':
        case 'long-compressed-string': {
          const pointer = reader.i32(fieldOffset);
          result[field.name] = pointer === -1 ? '' : decoder!.read(pointer, field.typeCode === 14);
          break;
        }
      }
    }
    return result;
  });
  const metadataComplete = metadata !== undefined && fields.every((field) => field.rangeLow !== null);
  if (!metadataComplete) warnings.push({ code: 'MISSING_METADATA', offset: start,
    message: `Incomplete metadata for ${shortName}; fields without metadata use short codes and raw integers.` });
  if (invalidRecords !== cancelledRecords) warnings.push({ code: 'RECORD_COUNT_MISMATCH', offset: start,
    message: `${shortName}: header declares ${cancelledRecords} cancelled records; found ${invalidRecords}.` });
  if (hasNonFiniteFloat) warnings.push({ code: 'NON_FINITE_FLOAT', offset: start,
    message: `${shortName}: non-finite floats are represented as null to preserve valid JSON.` });
  return { shortName, name: metadata?.definition.name ?? shortName, offset: start, recordSize,
    recordBitLimit, capacity, writtenRecords, cancelledRecords, validRecords: records.length,
    compressedStringBytes, headerCrc: reader.u32(start + 32), metadataComplete, fields, records };
}

function parseFields(reader: BinaryReader, start: number, count: number, recordSize: number, metadata?: IndexedTable): EaField[] {
  const fields: EaField[] = [];
  const shortNames = new Set<string>();
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    const offset = start + i * 16;
    const typeCode = reader.i32(offset);
    const type = fieldTypes.get(typeCode);
    if (type === undefined) throw new EaFileError('UNSUPPORTED_FIELD_TYPE', `Unsupported field type: ${typeCode}.`, offset);
    const bitOffset = reader.i32(offset + 4);
    const shortName = reader.text(offset + 8, 4);
    const depth = reader.i32(offset + 12);
    const width = typeCode === 0 || typeCode === 3 ? depth : 32;
    if (bitOffset < 0 || depth < 0 || width < 0 || bitOffset + width > recordSize * 8 ||
        (typeCode === 3 && depth > 32) || (typeCode !== 3 && bitOffset % 8 !== 0) ||
        (typeCode === 0 && depth % 8 !== 0)) {
      throw new EaFileError('INVALID_FORMAT', `Invalid offset or depth for field ${shortName}.`, offset);
    }
    const definition = metadata?.fields.get(shortName);
    const name = definition?.name ?? shortName;
    if (shortNames.has(shortName) || names.has(name)) {
      throw new EaFileError('INVALID_FORMAT', `Duplicate field name: ${name}.`, offset);
    }
    shortNames.add(shortName);
    names.add(name);
    fields.push({ shortName, name, type, typeCode, bitOffset, depth,
      rangeLow: definition?.rangeLow ?? null, rangeHigh: definition?.rangeHigh ?? null });
  }
  return fields.sort((a, b) => a.bitOffset - b.bitOffset);
}
