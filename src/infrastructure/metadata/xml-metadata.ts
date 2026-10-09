import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { EaFileError } from '../../domain/errors.js';
import type { MetadataField, MetadataSchema, MetadataTable } from '../../domain/models.js';
import { indexMetadata } from './schema-index.js';

export function parseMetadataXml(xml: string): MetadataSchema {
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new EaFileError('INVALID_METADATA', 'DTDs and external entities are not supported.');
  }
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new EaFileError('INVALID_METADATA', `Invalid XML: ${validation.err.msg}`);
  try {
    const parsed: unknown = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
    }).parse(xml);
    const tables: MetadataTable[] = collect(parsed, 'table').map((table) => ({
      shortName: stringValue(table, 'shortname'),
      name: stringValue(table, 'name'),
      fields: collect(table, 'field').map((field): MetadataField => ({
        shortName: stringValue(field, 'shortname'),
        name: stringValue(field, 'name'),
        rangeLow: integerValue(field, 'rangelow'),
        rangeHigh: optionalValue(field, 'rangehigh') === undefined ? null : integerValue(field, 'rangehigh'),
      })),
    }));
    if (tables.length === 0) throw new EaFileError('INVALID_METADATA', 'XML contains no table elements.');
    const schema = { tables };
    indexMetadata(schema);
    return schema;
  } catch (error) {
    if (error instanceof EaFileError) throw error;
    throw new EaFileError('INVALID_METADATA', 'Could not parse the metadata XML.', undefined, error);
  }
}

function collect(node: unknown, key: string): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((item) => collect(item, key));
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([name, value]) => {
    if (name === key) {
      return (Array.isArray(value) ? value : [value]).map((item: unknown) => {
        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
          throw new EaFileError('INVALID_METADATA', `Invalid ${key} element.`);
        }
        return item as Record<string, unknown>;
      });
    }
    return collect(value, key);
  });
}

function optionalValue(node: Record<string, unknown>, key: string): unknown {
  return node[`@_${key}`] ?? node[key];
}

function stringValue(node: Record<string, unknown>, key: string): string {
  const value = optionalValue(node, key);
  if (typeof value !== 'string' || value.length === 0) throw new EaFileError('INVALID_METADATA', `Missing or invalid ${key} metadata.`);
  return value;
}

function integerValue(node: Record<string, unknown>, key: string): number {
  const value = optionalValue(node, key);
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new EaFileError('INVALID_METADATA', `${key} metadata must be a decimal integer.`);
  }
  return Number(value);
}
