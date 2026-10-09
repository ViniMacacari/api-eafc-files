import { EaFileError } from '../../domain/errors.js';
import type { Endianness } from '../../domain/models.js';

export class BinaryWriter {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly little: boolean;

  constructor(bytes: Uint8Array, endianness: Endianness) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.little = endianness === 'little';
  }

  u16(offset: number, value: number): void { this.view.setUint16(offset, value, this.little); }
  u32(offset: number, value: number): void { this.view.setUint32(offset, value, this.little); }
  i32(offset: number, value: number): void { this.view.setInt32(offset, value, this.little); }
  f32(offset: number, value: number): void { this.view.setFloat32(offset, value, this.little); }

  integer(recordOffset: number, bitOffset: number, depth: number, value: number, rangeLow: number): void {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
      throw new EaFileError('INVALID_WRITE', 'Integer values must be signed 32-bit integers.');
    }
    const raw = (value - rangeLow) >>> 0;
    if (raw >= 2 ** depth) throw new EaFileError('INVALID_WRITE', `Integer value does not fit the ${depth}-bit field.`);
    for (let i = 0; i < depth; i++) {
      const bit = bitOffset + i;
      const offset = recordOffset + Math.floor(bit / 8);
      const shift = this.little ? bit % 8 : 7 - bit % 8;
      const digit = (raw >>> (this.little ? i : depth - 1 - i)) & 1;
      this.bytes[offset] = (this.bytes[offset]! & ~(1 << shift)) | (digit << shift);
    }
  }
}
