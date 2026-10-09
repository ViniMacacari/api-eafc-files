import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { EaFileError, eaFileJsonChunks, parseEaFile, parseMetadataXml, readEaFile } from '../dist/index.js';
import { expectedRow, fixtureMetadata, makeDatabase, makeSave } from './fixtures.mjs';

const parse = (bytes, options = {}) => parseEaFile(bytes, { metadata: fixtureMetadata, ...options });
const firstTable = (file) => file.databases[0].tables[0];
const code = (expected) => (error) => error instanceof EaFileError && error.code === expected;

for (const big of [false, true]) {
  test(`decodes bit gaps, floats, UTF-8, Huffman, and Int32 values (${big ? 'BE' : 'LE'})`, () => {
    const file = parse(makeDatabase({ big }));
    const table = firstTable(file);
    assert.deepEqual(table.records[0], expectedRow);
    assert.deepEqual(table.records[1], { ...expectedRow, nickname: '', description: '' });
    assert.equal(table.capacity, 4);
    assert.equal(table.writtenRecords, 3);
    assert.equal(table.validRecords, 2);
    assert.equal(table.cancelledRecords, 1);
    assert.equal(file.databases[0].endianness, big ? 'big' : 'little');
    assert.equal(file.metadataComplete, true);
    assert.deepEqual(file.warnings, []);
  });

  test(`decodes raw strings and long lengths (${big ? 'BE' : 'LE'})`, () => {
    const row = firstTable(parse(makeDatabase({ big, rawStrings: true }))).records[0];
    assert.equal(row.nickname, 'Zoë');
    assert.equal(row.description, 'Hello 🌍');
  });
}

test('all -1 pointers avoid allocating an undefined tree', () => {
  const row = firstTable(parse(makeDatabase({ allNull: true }))).records[0];
  assert.equal(row.nickname, ''); assert.equal(row.description, '');
});

test('empty tables accept the 0xFFFFFFFF string block size sentinel', () => {
  const db = makeDatabase();
  db.writeUInt16LE(0, 36 + 16); db.writeUInt16LE(0, 36 + 18); db.writeUInt16LE(0, 36 + 20);
  db.writeUInt32LE(0xFFFFFFFF, 36 + 12);
  const table = firstTable(parse(db));
  assert.deepEqual(table.records, []);
  assert.equal(table.compressedStringBytes, 0xFFFFFFFF);
});

test('reads squad and career saves with multiple databases and platforms', () => {
  const file = parse(makeSave([makeDatabase(), makeDatabase({ big: true })]), { fileName: 'CmMgrC2026' });
  assert.equal(file.source.kind, 'career');
  assert.equal(file.container, 'ea-save');
  assert.equal(file.inGameName, 'Test career');
  assert.equal(file.databases.length, 2);
  assert.deepEqual(firstTable(file).records[0], file.databases[1].tables[0].records[0]);
  assert.equal(file.databases[0].offset, 96);
  assert.equal(parse(makeSave(), { fileName: 'file.squad' }).source.kind, 'squad');
  assert.equal(parse(makeSave(), { fileName: 'Squads2026' }).source.kind, 'squad');
  assert.equal(parse(makeSave()).source.kind, 'unknown');
});

test('does not treat a DB signature inside a record as another database', () => {
  const db = makeDatabase();
  db.set([0x44, 0x42, 0, 8], 36 + 36 + 7 * 16 + 8);
  assert.equal(parse(makeSave([db])).databases.length, 1);
});

test('missing XML returns short codes and raw values with an explicit warning', () => {
  const file = parseEaFile(makeDatabase());
  const table = firstTable(file);
  assert.equal(table.name, 'TEST'); assert.equal(table.records[0].ID__, 17);
  assert.equal(table.records[0].GAP_, 1025);
  assert.equal(file.metadataComplete, false);
  assert.equal(table.fields[0].rangeLow, null);
  assert.equal(file.warnings[0].code, 'MISSING_METADATA');
});

test('table filtering accepts full names or short codes and preserves the directory count', () => {
  assert.equal(parse(makeDatabase(), { tables: ['players'] }).databases[0].tables.length, 1);
  assert.equal(parse(makeDatabase(), { tables: ['TEST'] }).databases[0].tables.length, 1);
  const empty = parse(makeDatabase(), { tables: ['missing'] }).databases[0];
  assert.equal(empty.tables.length, 0); assert.equal(empty.tableCount, 1);
  assert.throws(() => parse(makeDatabase(), { tables: [] }), code('INVALID_OPTIONS'));
});

test('preserves buffers with byteOffset and the original input', () => {
  const db = makeDatabase(), before = Buffer.from(db);
  const parent = Buffer.concat([Buffer.alloc(13, 255), db, Buffer.alloc(11, 255)]);
  const slice = parent.subarray(13, 13 + db.length);
  assert.deepEqual(firstTable(parse(slice)).records[0], expectedRow);
  assert.deepEqual(slice, before);
});

test('rejects missing databases, incomplete headers, and truncated databases', () => {
  assert.throws(() => parse(Buffer.alloc(128)), code('INVALID_FORMAT'));
  assert.throws(() => parse(Buffer.alloc(10)), code('TRUNCATED_FILE'));
  assert.throws(() => parse(makeDatabase().subarray(0, 80)), code('TRUNCATED_FILE'));
});

test('rejects invalid platforms, counts, and out-of-bounds pointers', () => {
  const platform = makeDatabase(); platform[4] = 2;
  assert.throws(() => parse(platform), code('INVALID_FORMAT'));
  const count = makeDatabase(); count.writeInt32LE(-1, 16);
  assert.throws(() => parse(count), code('INVALID_FORMAT'));
  const offset = makeDatabase(); offset.writeUInt32LE(0xFFFFFFFF, 28);
  assert.throws(() => parse(offset), code('TRUNCATED_FILE'));
  assert.throws(() => parse(makeDatabase({ capacity: 2 })), code('INVALID_FORMAT'));
});

test('rejects unknown types, invalid depths, and invalid field offsets', () => {
  const unknown = makeDatabase(); unknown.writeInt32LE(99, 72);
  assert.throws(() => parse(unknown), code('UNSUPPORTED_FIELD_TYPE'));
  const depth = makeDatabase(); depth.writeInt32LE(33, 72 + 16 + 12);
  assert.throws(() => parse(depth), code('INVALID_FORMAT'));
  const offset = makeDatabase(); offset.writeInt32LE(9999, 72 + 4);
  assert.throws(() => parse(offset), code('INVALID_FORMAT'));
});

test('rejects invalid compressed pointers and Huffman cycles', () => {
  const pointer = makeDatabase(); pointer.writeInt32LE(-2, 72 + 7 * 16 + 16);
  assert.throws(() => parse(pointer), code('INVALID_COMPRESSED_STRING'));
  const cycle = makeDatabase(); const pool = 72 + 7 * 16 + 3 * 29;
  cycle[pool + 4] = 1;
  assert.throws(() => parse(cycle), code('INVALID_COMPRESSED_STRING'));
  const size = makeDatabase(); size.writeInt32LE(7, 72 + 7 * 16 + 16);
  assert.throws(() => parse(size), code('INVALID_COMPRESSED_STRING'));
});

test('limits databases, tables, records, values, files, and strings', () => {
  for (const [key, value] of [['maxFileBytes', 10], ['maxTotalRecords', 1], ['maxDecodedValues', 1], ['maxDecodedStringBytes', 1]]) {
    assert.throws(() => parse(makeDatabase(), { limits: { [key]: value } }), code('LIMIT_EXCEEDED'));
  }
  assert.throws(() => parse(makeSave([makeDatabase(), makeDatabase()]), { limits: { maxDatabases: 1 } }), code('LIMIT_EXCEEDED'));
  const many = makeDatabase(); many.writeInt32LE(2, 16);
  assert.throws(() => parse(many, { limits: { maxTablesPerDatabase: 1 } }), code('LIMIT_EXCEEDED'));
  assert.throws(() => parse(makeDatabase(), { limits: { maxFileBytes: -1 } }), code('INVALID_OPTIONS'));
});

test('converts NaN to null and warns about cancelled-record count mismatches', () => {
  const db = makeDatabase(); db.writeUInt16LE(0, 36 + 20); db.writeFloatLE(NaN, 72 + 7 * 16 + 4);
  const file = parse(db);
  assert.equal(firstTable(file).records[0].rating, null);
  assert.deepEqual(file.warnings.map(w => w.code), ['RECORD_COUNT_MISMATCH', 'NON_FINITE_FLOAT']);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(file)));
});

test('incremental JSON preserves content, empty lists, and multiple databases', () => {
  for (const file of [parse(makeSave([makeDatabase(), makeDatabase()])), parse(makeDatabase(), { tables: ['none'] })]) {
    const parts = [...eaFileJsonChunks(file)];
    assert.deepEqual(JSON.parse(parts.join('')), JSON.parse(JSON.stringify(file)));
    assert.ok(parts.length > 2);
  }
});

test('__proto__ field names become data properties without modifying prototypes', () => {
  const metadata = structuredClone(fixtureMetadata);
  metadata.tables[0].fields[0].name = '__proto__';
  const row = firstTable(parse(makeDatabase(), { metadata })).records[0];
  assert.equal(row.__proto__, 16);
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  assert.equal(JSON.parse(JSON.stringify(row)).__proto__, 16);
});

test('XML accepts attributes, elements, namespaces, and standard entities', () => {
  const xml = '<db:database xmlns:db="urn:ea"><db:tables><db:table shortname="TEST" name="A &amp; B"><db:fields><db:field><shortname>ID__</shortname><name>playerid</name><rangelow>-1</rangelow><rangehigh>30</rangehigh></db:field></db:fields></db:table></db:tables></db:database>';
  const schema = parseMetadataXml(xml);
  assert.equal(schema.tables[0].name, 'A & B');
  assert.equal(firstTable(parse(makeDatabase(), { metadata: schema })).records[0].playerid, 16);
  assert.equal(firstTable(parse(makeDatabase(), { metadata: schema })).records[0].GAP_, 1025);
});

test('rejects invalid XML, DTDs, duplicate tables, and invalid ranges', () => {
  for (const xml of ['<database>', '<database/>', '<!DOCTYPE db [<!ENTITY e "value">]><database/>',
    '<database><table shortname="TEST" name="a"/><table shortname="TEST" name="b"/></database>',
    '<database><table shortname="TEST" name="a"><field shortname="ID__" name="id" rangelow="NaN"/></table></database>',
    '<database><table shortname="TEST" name="a"><field shortname="ID__" name="id"/></table></database>']) {
    assert.throws(() => parseMetadataXml(xml), code('INVALID_METADATA'));
  }
});

test('reads extensionless files and XML from disk, preserves bytes, and handles I/O errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eafc-reader-'));
  try {
    const path = join(directory, 'CmMgrC_fixture');
    const xmlPath = join(directory, 'meta.xml');
    const bytes = makeSave();
    await writeFile(path, bytes);
    await writeFile(xmlPath, '<database><table shortname="TEST" name="players"><fields><field shortname="ID__" name="playerid" rangelow="-1" rangehigh="30"/></fields></table></database>');
    const metadata = parseMetadataXml(await readFile(xmlPath, 'utf8'));
    const file = await readEaFile(path, { metadata });
    assert.equal(file.source.kind, 'career');
    assert.equal(firstTable(file).records[0].playerid, 16);
    assert.deepEqual(await readFile(path), bytes);
    await assert.rejects(readEaFile(join(directory, 'missing')), code('FILE_READ_FAILED'));
    await assert.rejects(readEaFile(directory), code('FILE_READ_FAILED'));
    await assert.rejects(readEaFile(path, { metadata: fixtureMetadata, version: 'FC 26' }), code('INVALID_OPTIONS'));
    await assert.rejects(readEaFile(path, { metadataPath: xmlPath }), code('INVALID_OPTIONS'));
    await assert.rejects(readEaFile(path, { limits: { maxFileBytes: 1 } }), code('LIMIT_EXCEEDED'));
  } finally {
    assert.equal(dirname(directory).toLowerCase(), tmpdir().toLowerCase());
    assert.ok(basename(directory).startsWith('eafc-reader-'));
    await rm(directory, { recursive: true });
  }
});
