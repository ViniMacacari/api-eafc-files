import { EaFileError } from '../../domain/errors.js';
import type { Endianness } from '../../domain/models.js';

const utf8 = new TextDecoder('utf-8');

export class BinaryReader {
  readonly bytes: Uint8Array;
  readonly start: number;
  readonly end: number;
  private readonly view: DataView;
  private readonly little: boolean;

  constructor(bytes: Uint8Array, endianness: Endianness = 'little', start = 0, end = bytes.byteLength) {
    this.bytes = bytes;
    this.start = start;
    this.end = end;
    this.little = endianness === 'little';
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.ensure(start, end - start);
  }

  ensure(offset: number, length: number): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length < 0 ||
        offset < this.start || offset + length > this.end || this.end > this.bytes.byteLength) {
      throw new EaFileError('TRUNCATED_FILE', 'Read exceeds the file, database, or table bounds.', offset);
    }
  }

  u8(offset: number): number { this.ensure(offset, 1); return this.view.getUint8(offset); }
  u16(offset: number): number { this.ensure(offset, 2); return this.view.getUint16(offset, this.little); }
  u32(offset: number): number { this.ensure(offset, 4); return this.view.getUint32(offset, this.little); }
  i32(offset: number): number { this.ensure(offset, 4); return this.view.getInt32(offset, this.little); }
  f32(offset: number): number { this.ensure(offset, 4); return this.view.getFloat32(offset, this.little); }
  slice(offset: number, length: number): Uint8Array {
    this.ensure(offset, length);
    return this.bytes.subarray(offset, offset + length);
  }
  text(offset: number, length: number, nullPadded = false): string {
    let bytes = this.slice(offset, length);
    if (nullPadded) {
      const zero = bytes.indexOf(0);
      if (zero !== -1) bytes = bytes.subarray(0, zero);
    }
    return utf8.decode(bytes);
  }

  integer(recordOffset: number, bitOffset: number, depth: number, rangeLow: number): number {
    this.ensure(recordOffset + Math.floor(bitOffset / 8), Math.ceil((bitOffset % 8 + depth) / 8));
    let raw = 0;
    for (let i = 0; i < depth; i++) {
      const bit = bitOffset + i;
      const value = this.u8(recordOffset + Math.floor(bit / 8));
      const digit = (value >>> (this.little ? bit % 8 : 7 - bit % 8)) & 1;
      raw = this.little ? raw + digit * 2 ** i : raw * 2 + digit;
    }
    return (raw + rangeLow) | 0;
  }
}
