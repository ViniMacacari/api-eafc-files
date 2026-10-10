export type EaFileErrorCode =
  | 'INVALID_OPTIONS'
  | 'FILE_READ_FAILED'
  | 'INVALID_METADATA'
  | 'INVALID_FORMAT'
  | 'TRUNCATED_FILE'
  | 'UNSUPPORTED_FIELD_TYPE'
  | 'INVALID_COMPRESSED_STRING'
  | 'INVALID_WRITE'
  | 'FILE_WRITE_FAILED'
  | 'LIMIT_EXCEEDED';

export class EaFileError extends Error {
  readonly code: EaFileErrorCode;
  readonly offset: number | undefined;

  constructor(code: EaFileErrorCode, message: string, offset?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'EaFileError';
    this.code = code;
    this.offset = offset;
  }

  toJSON(): { code: EaFileErrorCode; message: string; offset: number | null } {
    return { code: this.code, message: this.message, offset: this.offset ?? null };
  }
}
