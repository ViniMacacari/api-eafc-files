import { EaFileError } from '../../domain/errors.js';
import type { DecodeBudget } from '../../domain/limits.js';
import type { EaField, EaRecord, EaTable, Endianness, RecordValue } from '../../domain/models.js';
import { BinaryReader } from './binary-reader.js';
import { BinaryWriter } from './binary-writer.js';
import { databaseCrc } from './crc.js';
import { encodeStringPool, stringKey } from './huffman-encoder.js';

export function validateTableSchema(table: EaTable, original: EaTable): void {
  for (const key of ['offset', 'recordSize', 'recordBitLimit', 'capacity', 'writtenRecords', 'cancelledRecords'] as const) {
    if (table[key] !== original[key]) throw new EaFileError('INVALID_WRITE', `Table structure cannot be changed: ${table.shortName}.${key}.`);
  }
  if (!Array.isArray(table.fields) || table.fields.length !== original.fields.length || !Array.isArray(table.records)) {
    throw new EaFileError('INVALID_WRITE', 'Table fields and records must match the source schema.');
  }
  const names = new Set<string>();
  let previousEnd = 0;
  for (const [index, field] of table.fields.entries()) {
    const source = original.fields[index]!;
    for (const key of ['shortName', 'type', 'typeCode', 'bitOffset', 'depth'] as const) {
      if (field[key] !== source[key]) throw new EaFileError('INVALID_WRITE', 'Field descriptors cannot be changed.');
    }
    if (typeof field.name !== 'string' || !field.name || names.has(field.name) ||
        !validRange(field.rangeLow) || !validRange(field.rangeHigh)) {
      throw new EaFileError('INVALID_WRITE', 'Field names must be unique and ranges must be signed 32-bit integers or null.');
    }
    names.add(field.name);
    const width = field.typeCode === 0 || field.typeCode === 3 ? field.depth : 32;
    if (field.bitOffset < previousEnd && width > 0) throw new EaFileError('INVALID_WRITE', 'Overlapping fields cannot be written.');
    previousEnd = Math.max(previousEnd, field.bitOffset + width);
  }
  for (const record of table.records) {
    if (record === null || typeof record !== 'object' || Array.isArray(record) ||
        Object.keys(record).length !== names.size || Object.keys(record).some(name => !names.has(name))) {
      throw new EaFileError('INVALID_WRITE', 'Every record must contain exactly the declared fields.');
    }
  }
}

export function recordValue(original: EaRecord, field: EaField): RecordValue {
  const value = original[field.shortName]!;
  return field.type === 'integer' ? ((value as number) + (field.rangeLow ?? 0)) | 0 : value;
}

export function tableChanged(table: EaTable, original: EaTable): boolean {
  if (table.records.length !== original.records.length) return true;
  return table.records.some((record, index) => table.fields.some(field => !Object.is(record[field.name], recordValue(original.records[index]!, field))));
}

export function reserveUnchangedTable(bytes: Uint8Array, table: EaTable, endianness: Endianness, budget: DecodeBudget): void {
  budget.addRecords(table.writtenRecords, table.fields.length, table.offset);
  const reader = new BinaryReader(bytes, endianness);
  const recordsStart = table.offset + 36 + table.fields.length * 16;
  const stringsStart = recordsStart + table.writtenRecords * table.recordSize;
  for (let row = 0; row < table.writtenRecords; row++) {
    const recordOffset = recordsStart + row * table.recordSize;
    if ((reader.u8(recordOffset + table.recordSize - 1) & 128) !== 0) continue;
    for (const field of table.fields) {
      if (field.typeCode === 0) budget.addString(field.depth / 8, recordOffset);
      else if (field.typeCode === 13 || field.typeCode === 14) {
        const pointer = reader.i32(recordOffset + field.bitOffset / 8);
        if (pointer === -1) continue;
        const offset = stringsStart + pointer;
        const length = field.typeCode === 13 ? reader.u8(offset) :
          (endianness === 'big' ? reader.u8(offset) + reader.u8(offset + 1) * 256 : reader.u8(offset) * 256 + reader.u8(offset + 1));
        budget.addString(length, offset);
      }
    }
  }
}

export function encodeTable(sourceBytes: Uint8Array, table: EaTable, original: EaTable,
  endianness: Endianness, budget: DecodeBudget): Uint8Array {
  if (table.records.length > 65535) throw new EaFileError('LIMIT_EXCEEDED', 'Tables cannot exceed 65,535 records.');
  if (table.records.length && table.recordSize === 0) throw new EaFileError('INVALID_WRITE', 'Zero-width tables cannot contain records.');
  budget.addRecords(table.records.length, table.fields.length, table.offset);
  for (const field of table.fields) {
    if (field.typeCode === 0) budget.addString(field.depth / 8 * table.records.length, table.offset);
  }
  const originalRecordsStart = original.offset + 36 + original.fields.length * 16;
  const originalOffsets: number[] = [];
  for (let row = 0; row < original.writtenRecords; row++) {
    const offset = originalRecordsStart + row * original.recordSize;
    if ((sourceBytes[offset + original.recordSize - 1]! & 128) === 0) originalOffsets.push(offset);
  }
  const compressed = table.fields.filter(field => field.typeCode === 13 || field.typeCode === 14);
  const pool = encodeStringPool(table.records.flatMap(record => compressed.map(field => ({
    value: record[field.name] as string, long: field.typeCode === 14,
  }))), endianness === 'big', budget);
  const recordsStart = 36 + table.fields.length * 16;
  const stringsStart = recordsStart + table.records.length * table.recordSize;
  const length = stringsStart + Math.ceil(pool.bytes.length / 8) * 8 + 4;
  if (length > budget.limits.maxFileBytes) throw new EaFileError('LIMIT_EXCEEDED', 'Encoded table exceeds maxFileBytes.');
  const bytes = new Uint8Array(length);
  bytes.set(sourceBytes.subarray(original.offset, originalRecordsStart));
  const writer = new BinaryWriter(bytes, endianness);
  writer.u32(12, pool.bytes.length);
  writer.u16(16, Math.max(original.capacity, table.records.length));
  writer.u16(18, table.records.length);
  writer.u16(20, 0);
  for (const [index, record] of table.records.entries()) {
    const offset = recordsStart + index * table.recordSize;
    const originalOffset = originalOffsets[index];
    if (originalOffset !== undefined) bytes.set(sourceBytes.subarray(originalOffset, originalOffset + table.recordSize), offset);
    for (const field of table.fields) {
      const value = record[field.name]!;
      const unchanged = originalOffset !== undefined && Object.is(value, recordValue(original.records[index]!, field));
      const position = offset + Math.floor(field.bitOffset / 8);
      if (field.typeCode === 13 || field.typeCode === 14) {
        writer.i32(position, value === '' ? -1 : pool.pointers.get(stringKey(value as string, field.typeCode === 14))!);
      } else if (!unchanged) {
        switch (field.type) {
          case 'integer':
            if (typeof value !== 'number') throw new EaFileError('INVALID_WRITE', 'Integer fields require numbers.');
            writer.integer(offset, field.bitOffset, field.depth, value, field.rangeLow ?? 0);
            break;
          case 'float':
            if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
              throw new EaFileError('INVALID_WRITE', 'Float fields require finite float32 values; unchanged null values retain their original bits.');
            }
            writer.f32(position, value);
            break;
          case 'string': {
            if (typeof value !== 'string' || value.includes('\0')) throw new EaFileError('INVALID_WRITE', 'Fixed strings must not contain null characters.');
            const width = field.depth / 8;
            if (value.length > width) throw new EaFileError('INVALID_WRITE', 'Fixed string exceeds its field width.');
            const encoded = new TextEncoder().encode(value);
            if (encoded.length > width || new TextDecoder().decode(encoded) !== value) {
              throw new EaFileError('INVALID_WRITE', 'Fixed UTF-8 string exceeds its field width or contains malformed Unicode.');
            }
            bytes.fill(0, position, position + width);
            bytes.set(encoded, position);
            break;
          }
        }
      }
    }
    if ((bytes[offset + table.recordSize - 1]! & 128) !== 0) {
      throw new EaFileError('INVALID_WRITE', 'Record values must not set the cancellation flag.');
    }
  }
  bytes.set(pool.bytes, stringsStart);
  writer.u32(32, databaseCrc(bytes.subarray(0, 32)));
  writer.u32(length - 4, databaseCrc(bytes.subarray(36, length - 4)));
  return bytes;
}

function validRange(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647);
}
