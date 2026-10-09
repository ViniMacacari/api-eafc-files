import type { ReadLimits } from './models.js';

export interface SerializeOptions {
  readonly limits?: Partial<ReadLimits>;
  readonly saveIntegrity?: 'invalidate' | 'preserve';
}

export interface WriteFileOptions extends SerializeOptions {
  readonly overwrite?: boolean;
}

export interface WriteFileResult {
  readonly path: string;
  readonly byteLength: number;
}
