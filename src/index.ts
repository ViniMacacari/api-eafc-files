export { parseEaFile } from './application/parse-ea-file.js';
export { readEaFile } from './application/read-ea-file.js';
export { readTemplateDatabase } from './application/read-template-database.js';
export { loadTemplateMetadata } from './application/load-template-metadata.js';
export { SUPPORTED_VERSIONS, TEMPLATE_DATABASES } from './domain/templates.js';
export type { EaFcVersion, TemplateDatabase } from './domain/templates.js';
export { eaFileJsonChunks } from './application/json-chunks.js';
export { parseMetadataXml } from './infrastructure/metadata/xml-metadata.js';
export { DEFAULT_LIMITS } from './domain/limits.js';
export { EaFileError } from './domain/errors.js';
export type { EaFileErrorCode } from './domain/errors.js';
export type { EaFile, EaDatabase, EaTable, EaField, EaRecord, EaWarning, Endianness, FieldType,
  FileKind, MetadataField, MetadataTable, MetadataSchema, ParseOptions, ReadFileOptions, ReadTemplateOptions, ReadLimits, RecordValue } from './domain/models.js';
