import type { EaFcVersion, TemplateDatabase } from './templates.js';

export type FileKind = 'squad' | 'career' | 'database' | 'unknown';
export type Endianness = 'little' | 'big';
export type FieldType = 'string' | 'integer' | 'float' | 'short-compressed-string' | 'long-compressed-string';
export type RecordValue = string | number | null;
export type EaRecord = Record<string, RecordValue>;

export interface MetadataField {
  readonly shortName: string;
  readonly name: string;
  readonly rangeLow: number;
  readonly rangeHigh: number | null;
}

export interface MetadataTable {
  readonly shortName: string;
  readonly name: string;
  readonly fields: readonly MetadataField[];
}

export interface MetadataSchema {
  readonly tables: readonly MetadataTable[];
}

export interface EaField {
  readonly shortName: string;
  readonly name: string;
  readonly type: FieldType;
  readonly typeCode: number;
  readonly bitOffset: number;
  readonly depth: number;
  readonly rangeLow: number | null;
  readonly rangeHigh: number | null;
}

export interface EaTable {
  readonly shortName: string;
  readonly name: string;
  readonly offset: number;
  readonly recordSize: number;
  readonly recordBitLimit: number;
  readonly capacity: number;
  readonly writtenRecords: number;
  readonly cancelledRecords: number;
  readonly validRecords: number;
  readonly compressedStringBytes: number;
  readonly headerCrc: number;
  readonly metadataComplete: boolean;
  readonly fields: readonly EaField[];
  readonly records: readonly EaRecord[];
}

export interface EaDatabase {
  readonly index: number;
  readonly offset: number;
  readonly byteLength: number;
  readonly endianness: Endianness;
  readonly platform: 'pc' | 'xbox';
  readonly headerCrc: number;
  readonly directoryCrc: number;
  readonly tableCount: number;
  readonly tables: readonly EaTable[];
}

export interface EaWarning {
  readonly code: 'MISSING_METADATA' | 'RECORD_COUNT_MISMATCH' | 'NON_FINITE_FLOAT';
  readonly message: string;
  readonly offset: number;
}

export interface EaFile {
  readonly formatVersion: 1;
  readonly source: { readonly fileName: string | null; readonly byteLength: number; readonly kind: FileKind };
  readonly container: 'ea-save' | 'database';
  readonly inGameName: string | null;
  readonly metadataComplete: boolean;
  readonly databases: readonly EaDatabase[];
  readonly warnings: readonly EaWarning[];
}

export interface ReadLimits {
  readonly maxFileBytes: number;
  readonly maxDatabases: number;
  readonly maxTablesPerDatabase: number;
  readonly maxTotalRecords: number;
  readonly maxDecodedValues: number;
  readonly maxDecodedStringBytes: number;
}

export interface ParseOptions {
  readonly fileName?: string;
  readonly kind?: FileKind;
  readonly metadata?: MetadataSchema;
  readonly tables?: readonly string[];
  readonly limits?: Partial<ReadLimits>;
}

export interface ReadFileOptions extends ParseOptions {
  readonly version?: EaFcVersion;
  readonly database?: TemplateDatabase;
}

export interface ReadTemplateOptions extends Omit<ReadFileOptions, 'version' | 'metadata'> {
  readonly version: EaFcVersion;
}
