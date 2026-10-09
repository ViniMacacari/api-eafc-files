import { EaFileError } from '../domain/errors.js';
import { DecodeBudget, resolveLimits } from '../domain/limits.js';
import type { EaFile, EaTable } from '../domain/models.js';
import type { SerializeOptions } from '../domain/write-models.js';
import { encodeDatabase } from '../infrastructure/binary/database-writer.js';
import { parseEaFile } from './parse-ea-file.js';

export function serializeEaFile(sourceBytes: Uint8Array, file: EaFile, options: SerializeOptions = {}): Uint8Array {
  try {
    return serialize(sourceBytes, file, options);
  } catch (error) {
    if (error instanceof EaFileError) throw error;
    throw new EaFileError('INVALID_WRITE', 'Invalid file data or write options.', undefined, error);
  }
}

function serialize(sourceBytes: Uint8Array, file: EaFile, options: SerializeOptions): Uint8Array {
  const limits = resolveLimits(options.limits);
  const integrity = options.saveIntegrity ?? 'invalidate';
  if (integrity !== 'invalidate' && integrity !== 'preserve') throw new EaFileError('INVALID_OPTIONS', 'Invalid saveIntegrity option.');
  if (!(sourceBytes instanceof Uint8Array) || file.formatVersion !== 1 || !Array.isArray(file.databases) ||
      file.source.byteLength !== sourceBytes.length || file.databases.some(db => !Array.isArray(db.tables))) {
    throw new EaFileError('INVALID_WRITE', 'File data must come from a read of the supplied source bytes.');
  }
  const selected = [...new Set(file.databases.flatMap(db => db.tables.map((table: EaTable) => table.shortName)))];
  const original = parseEaFile(sourceBytes, { tables: selected.length ? selected : ['__none__'], limits });
  if (file.container !== original.container || file.databases.length !== original.databases.length) {
    throw new EaFileError('INVALID_WRITE', 'Containers and databases cannot be added, removed, or reordered.');
  }
  const budget = new DecodeBudget(limits);
  const chunkedSave = new TextDecoder().decode(sourceBytes.subarray(0, 8)) === 'FBCHUNKS';
  let changed = false;
  let bytes = Uint8Array.from(sourceBytes);
  for (const [index, database] of file.databases.entries()) {
    const source = original.databases[index]!;
    const encoded = encodeDatabase(sourceBytes, database, source, file.container === 'ea-save', budget);
    if (encoded === undefined) continue;
    changed = true;
    if (file.container === 'ea-save') bytes.set(encoded, source.offset);
    else {
      const length = encoded.length + sourceBytes.length - source.byteLength;
      if (length > limits.maxFileBytes) throw new EaFileError('LIMIT_EXCEEDED', 'Encoded file exceeds maxFileBytes.');
      bytes = new Uint8Array(length);
      bytes.set(encoded);
      bytes.set(sourceBytes.subarray(source.byteLength), encoded.length);
    }
  }
  if (file.inGameName !== original.inGameName) {
    if (file.container !== 'ea-save' || typeof file.inGameName !== 'string' || file.inGameName.includes('\0')) {
      throw new EaFileError('INVALID_WRITE', 'Only save containers have an editable internal name.');
    }
    const nameEnd = sourceBytes.indexOf(0, 18);
    const boundary = Math.min(chunkedSave ? 118 : 274, original.databases[0]!.offset);
    if (nameEnd >= boundary) throw new EaFileError('INVALID_WRITE', 'The internal name overlaps a reserved header area.');
    let end = nameEnd + 1;
    while (end < boundary && sourceBytes[end] === 0) end++;
    const name = Uint8Array.from(file.inGameName, character => character.charCodeAt(0));
    if (file.inGameName.length >= end - 18 || [...file.inGameName].some(character => character.charCodeAt(0) > 255)) {
      throw new EaFileError('INVALID_WRITE', 'Internal names must fit the existing null-padded allocation and use Latin-1 characters.');
    }
    bytes.fill(0, 18, end);
    bytes.set(name, 18);
    changed = true;
  }
  if (changed && integrity === 'invalidate' && chunkedSave) {
    const firstDatabase = original.databases[0]!.offset;
    for (const [offset, length] of [[118, 32], [218, 16], [1142, 16]] as const) {
      if (offset + length > firstDatabase) throw new EaFileError('INVALID_WRITE', 'Save integrity areas overlap a database.');
      bytes.fill(0, offset, offset + length);
    }
  }
  return bytes;
}
