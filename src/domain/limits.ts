import { EaFileError } from './errors.js';
import type { ReadLimits } from './models.js';

export const DEFAULT_LIMITS: Readonly<ReadLimits> = Object.freeze({
  maxFileBytes: 256 * 1024 * 1024,
  maxDatabases: 64,
  maxTablesPerDatabase: 4096,
  maxTotalRecords: 1_000_000,
  maxDecodedValues: 64_000_000,
  maxDecodedStringBytes: 64 * 1024 * 1024,
});

export function resolveLimits(overrides: Partial<ReadLimits> = {}): ReadLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new EaFileError('INVALID_OPTIONS', `${key} must be a positive safe integer.`);
    }
  }
  return limits;
}

export class DecodeBudget {
  private records = 0;
  private values = 0;
  private stringBytes = 0;
  readonly limits: ReadLimits;

  constructor(limits: ReadLimits) { this.limits = limits; }

  addRecords(records: number, fields: number, offset: number): void {
    this.records += records;
    this.values += records * fields;
    if (this.records > this.limits.maxTotalRecords || this.values > this.limits.maxDecodedValues) {
      throw new EaFileError('LIMIT_EXCEEDED', 'Decoded record or value limit exceeded.', offset);
    }
  }

  addString(bytes: number, offset: number): void {
    this.stringBytes += bytes;
    if (this.stringBytes > this.limits.maxDecodedStringBytes) {
      throw new EaFileError('LIMIT_EXCEEDED', 'Decoded string byte limit exceeded.', offset);
    }
  }
}
