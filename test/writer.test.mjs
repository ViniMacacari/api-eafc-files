import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { EaFileError, loadTemplateMetadata, parseEaFile, serializeEaFile, writeEaFile } from '../dist/index.js';
import { expectedRow, fixtureMetadata, makeDatabase, makeSave } from './fixtures.mjs';

const options = { metadata: fixtureMetadata };
const code = expected => error => error instanceof EaFileError && error.code === expected;
const firstTable = file => file.databases[0].tables[0];

function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) value = (value << 1) ^ ((value & 0x80000000) ? 0x04c11db7 : 0);
  }
  return value >>> 0;
}

function assertCrcs(bytes, database) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = database.endianness === 'little';
  const start = database.offset, end = start + database.byteLength;
  const base = start + 28 + database.tableCount * 8;
  assert.equal(view.getUint32(start + 20, little), crc(bytes.subarray(start, start + 20)));
  assert.equal(view.getUint32(base - 4, little), crc(bytes.subarray(start + 24, base - 4)));
  const offsets = Array.from({ length: database.tableCount }, (_, index) => base + view.getUint32(start + 28 + index * 8, little)).sort((a, b) => a - b);
  for (const [index, offset] of offsets.entries()) {
    const tableEnd = offsets[index + 1] ?? end;
    assert.equal(view.getUint32(offset + 32, little), crc(bytes.subarray(offset, offset + 32)));
    assert.equal(view.getUint32(tableEnd - 4, little), crc(bytes.subarray(offset + 36, tableEnd - 4)));
  }
}

assert.equal(crc(Buffer.from('123456789')), 0x0376e6e7);

for (const big of [false, true]) {
  for (const rawStrings of [false, true]) {
    test(`unchanged ${rawStrings ? 'raw' : 'Huffman'} files remain byte-identical (${big ? 'BE' : 'LE'})`, () => {
      const bytes = makeDatabase({ big, rawStrings });
      const result = serializeEaFile(bytes, JSON.parse(JSON.stringify(parseEaFile(bytes, options))));
      assert.deepEqual(Buffer.from(result), bytes);
      assert.notEqual(result.buffer, bytes.buffer);
    });
  }

  test(`writes all field types, new Unicode symbols, and CRCs (${big ? 'BE' : 'LE'})`, () => {
    const source = makeDatabase({ big }), before = Buffer.from(source);
    const data = parseEaFile(source, options);
    Object.assign(firstTable(data).records[0], { playerid: 30, birthdate: 2000, rating: 2.75, name: 'Anne',
      nickname: 'Hello 🌍', description: 'A long UTF-8 string: 日本語', signed: -12345 });
    const output = serializeEaFile(source, data);
    const decoded = parseEaFile(output, options);
    assert.deepEqual(firstTable(decoded).records[0], firstTable(data).records[0]);
    assert.equal(firstTable(decoded).cancelledRecords, 0);
    assert.equal(firstTable(decoded).writtenRecords, 2);
    assert.deepEqual(decoded.warnings, []);
    assertCrcs(output, decoded.databases[0]);
    assert.deepEqual(source, before);
  });

  test(`adds, deletes, and empties records without changing descriptors (${big ? 'BE' : 'LE'})`, () => {
    const bytes = makeDatabase({ big });
    const original = parseEaFile(bytes, options);
    for (const records of [[], [expectedRow], Array.from({ length: 5 }, (_, index) => ({ ...expectedRow, playerid: index }))]) {
      const data = structuredClone(original);
      firstTable(data).records = records;
      const output = serializeEaFile(bytes, data);
      const decoded = parseEaFile(output, options);
      assert.deepEqual(firstTable(decoded).records, records);
      assert.deepEqual(firstTable(decoded).fields, firstTable(original).fields);
      assert.equal(firstTable(decoded).capacity, Math.max(4, records.length));
      assertCrcs(output, decoded.databases[0]);
    }
  });
}

test('preserves opaque save regions, database offsets, and untouched databases', () => {
  const bytes = makeSave([makeDatabase(), makeDatabase({ big: true })]);
  bytes.fill(0x5a, bytes.length - 7);
  const data = parseEaFile(bytes, options);
  firstTable(data).records[0].nickname = 'A';
  const output = serializeEaFile(bytes, data);
  const decoded = parseEaFile(output, options);
  assert.equal(output.length, bytes.length);
  assert.deepEqual(decoded.databases.map(db => [db.offset, db.byteLength]), data.databases.map(db => [db.offset, db.byteLength]));
  const second = data.databases[1];
  assert.deepEqual(Buffer.from(output.subarray(second.offset)), bytes.subarray(second.offset));
  assert.deepEqual(Buffer.from(output.subarray(0, data.databases[0].offset)), bytes.subarray(0, data.databases[0].offset));
  assert.equal(firstTable(decoded).records[0].nickname, 'A');
  assertCrcs(output, decoded.databases[0]);
});

test('filtered reads preserve unselected tables and standalone trailers', () => {
  const tableBytes = makeDatabase().subarray(36);
  const source = Buffer.alloc(44 + tableBytes.length * 2 + 6);
  source.set(makeDatabase().subarray(0, 24));
  source.writeInt32LE(source.length - 6, 8);
  source.writeInt32LE(2, 16);
  source.write('TEST', 24); source.writeUInt32LE(0, 28);
  source.write('OTHR', 32); source.writeUInt32LE(tableBytes.length, 36);
  source.set(tableBytes, 44); source.set(tableBytes, 44 + tableBytes.length);
  source.fill(0xab, source.length - 6);
  const original = parseEaFile(source);
  const data = parseEaFile(source, { ...options, tables: ['players'] });
  firstTable(data).records[0].nickname = 'New symbols: Ω';
  const output = serializeEaFile(source, data);
  const decoded = parseEaFile(output);
  assert.equal(decoded.databases[0].tableCount, 2);
  assert.deepEqual(decoded.databases[0].tables[1].records, original.databases[0].tables[1].records);
  assert.deepEqual(Buffer.from(output.subarray(output.length - 6)), source.subarray(source.length - 6));
  assertCrcs(output, decoded.databases[0]);
});

test('invalidates known save integrity areas only when data changes', () => {
  const header = Buffer.alloc(1200);
  header.write('FBCHUNKS'); header.write('Test career', 18);
  for (const [offset, length] of [[118, 32], [218, 16], [1142, 16]]) header.fill(0x55, offset, offset + length);
  const source = Buffer.concat([header, makeDatabase()]);
  const data = parseEaFile(source, options);
  assert.deepEqual(Buffer.from(serializeEaFile(source, data)), source);
  firstTable(data).records[0].nickname = 'A';
  for (const saveIntegrity of ['invalidate', 'preserve']) {
    const output = serializeEaFile(source, data, { saveIntegrity });
    for (const [offset, length] of [[118, 32], [218, 16], [1142, 16]]) {
      assert.deepEqual(output.subarray(offset, offset + length), new Uint8Array(length).fill(saveIntegrity === 'invalidate' ? 0 : 0x55));
    }
    assert.deepEqual(Buffer.from(output.subarray(234, 1142)), source.subarray(234, 1142));
  }
  data.inGameName = 'x'.repeat(99);
  assert.equal(parseEaFile(serializeEaFile(source, data), options).inGameName, data.inGameName);
  data.inGameName = 'x'.repeat(100);
  assert.throws(() => serializeEaFile(source, data), code('INVALID_WRITE'));
});

test('renames containers within their original allocation and rejects invalid names', () => {
  const bytes = makeSave();
  const data = parseEaFile(bytes, options);
  data.inGameName = 'New career';
  assert.equal(parseEaFile(serializeEaFile(bytes, data), options).inGameName, 'New career');
  for (const name of ['x'.repeat(256), 'Name\0suffix', '🌍']) {
    data.inGameName = name;
    assert.throws(() => serializeEaFile(bytes, data), code('INVALID_WRITE'));
  }
});

test('rejects save growth while allowing standalone database growth', () => {
  const db = makeDatabase(), save = makeSave([db]);
  for (const bytes of [db, save]) {
    const data = parseEaFile(bytes, options);
    firstTable(data).records = Array.from({ length: 40 }, () => ({ ...expectedRow }));
    if (bytes === save) assert.throws(() => serializeEaFile(bytes, data), code('INVALID_WRITE'));
    else assert.equal(firstTable(parseEaFile(serializeEaFile(bytes, data), options)).records.length, 40);
  }
});

test('handles empty string pools and single-symbol Huffman trees', () => {
  const source = makeDatabase({ allNull: true });
  for (const nickname of ['', 'zzzz']) {
    const data = parseEaFile(source, options);
    firstTable(data).records[0].playerid = 18;
    firstTable(data).records[0].nickname = nickname;
    const output = serializeEaFile(source, data);
    const decoded = parseEaFile(output, options);
    assert.equal(firstTable(decoded).records[0].nickname, nickname);
    assert.equal(firstTable(decoded).records[0].description, '');
    assertCrcs(output, decoded.databases[0]);
  }
});

test('rejects invalid values, missing fields, and structural changes', () => {
  const bytes = makeDatabase(), original = parseEaFile(bytes, options);
  const changes = [
    data => firstTable(data).records[0].playerid = 31,
    data => firstTable(data).records[0].playerid = 1.5,
    data => firstTable(data).records[0].signed = 2147483648,
    data => firstTable(data).records[0].rating = null,
    data => firstTable(data).records[0].rating = Infinity,
    data => firstTable(data).records[0].rating = 1e100,
    data => firstTable(data).records[0].name = 'too many bytes',
    data => firstTable(data).records[0].nickname = '🌍'.repeat(64),
    data => firstTable(data).records[0].description = 'x'.repeat(65536),
    data => firstTable(data).records[0].name = 'bad\0name',
    data => firstTable(data).records[0].nickname = '\ud800',
    data => firstTable(data).records[0].nickname = 123,
    data => delete firstTable(data).records[0].playerid,
    data => firstTable(data).records[0].extra = 1,
    data => firstTable(data).records[0] = null,
    data => firstTable(data).recordSize++,
    data => firstTable(data).fields[0].depth++,
    data => firstTable(data).fields[0].rangeLow = 1.25,
    data => data.databases[0].tables.push(firstTable(data)),
    data => data.databases[0].endianness = 'big',
    data => data.databases = [],
    data => data.source.byteLength++,
  ];
  for (const change of changes) {
    const data = structuredClone(original); change(data);
    assert.throws(() => serializeEaFile(bytes, data), code('INVALID_WRITE'));
  }
});

test('retains unchanged NaN bits, bit gaps, and input byte offsets', () => {
  const source = makeDatabase();
  const recordStart = 36 + 36 + 7 * 16;
  source.writeUInt32LE(0x7fc01234, recordStart + 4);
  source[recordStart + 3] = 0x5a;
  const storage = Buffer.concat([Buffer.alloc(11), source, Buffer.alloc(9)]);
  const slice = storage.subarray(11, 11 + source.length);
  const data = parseEaFile(slice, options);
  firstTable(data).records[0].playerid = 20;
  const output = serializeEaFile(slice, data);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  assert.equal(view.getUint32(recordStart + 4, true), 0x7fc01234);
  assert.equal(output[recordStart + 3], 0x5a);
  assert.equal(firstTable(parseEaFile(output, options)).records[0].rating, null);
  assert.equal(storage[0], 0);
  assert.deepEqual(slice, source);
});

test('enforces output budgets, record limits, and cancellation flags', () => {
  const source = makeDatabase(), data = parseEaFile(source, options);
  firstTable(data).records = Array.from({ length: 5 }, () => ({ ...expectedRow }));
  assert.throws(() => serializeEaFile(source, data, { limits: { maxTotalRecords: 4 } }), code('LIMIT_EXCEEDED'));
  assert.throws(() => serializeEaFile(source, data, { limits: { maxFileBytes: source.length } }), code('LIMIT_EXCEEDED'));
  firstTable(data).records = Array.from({ length: 65536 }, () => expectedRow);
  assert.throws(() => serializeEaFile(source, data), code('LIMIT_EXCEEDED'));
  source.writeInt32LE(231, 36 + 36 + 6 * 16 + 4);
  source.writeInt32LE(1, 36 + 36 + 6 * 16 + 12);
  const flagData = parseEaFile(source, options);
  firstTable(flagData).records[0].signed = 1;
  assert.throws(() => serializeEaFile(source, flagData), code('INVALID_WRITE'));
});

test('counts fixed strings and unchanged databases in output decoding budgets', () => {
  const source = makeDatabase(), data = parseEaFile(source, options);
  firstTable(data).records[0].nickname = 'x'.repeat(20);
  assert.throws(() => serializeEaFile(source, data, { limits: { maxDecodedStringBytes: 25 } }), code('LIMIT_EXCEEDED'));
  const save = makeSave([source, source]), saveData = parseEaFile(save, options);
  firstTable(saveData).records[0].nickname = 'x'.repeat(26);
  assert.throws(() => serializeEaFile(save, saveData, { limits: { maxDecodedStringBytes: 50 } }), code('LIMIT_EXCEEDED'));
});

test('rejects missing record CRCs and additions to zero-width tables', () => {
  const source = makeDatabase().subarray(0, -4);
  source.writeInt32LE(source.length, 8);
  const data = parseEaFile(source, options);
  firstTable(data).records[0].playerid = 20;
  assert.throws(() => serializeEaFile(source, data), code('INVALID_WRITE'));
  const empty = Buffer.alloc(76);
  empty.set(makeDatabase().subarray(0, 24));
  empty.writeInt32LE(76, 8); empty.write('TEST', 24);
  const emptyData = parseEaFile(empty);
  firstTable(emptyData).records = [{}];
  assert.throws(() => serializeEaFile(empty, emptyData), code('INVALID_WRITE'));
});

test('file writes create new outputs, require explicit overwrite, and clean temporary files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eafc-writer-'));
  try {
    const source = join(directory, 'file.squad'), output = join(directory, 'new.squad');
    const bytes = makeSave(); await writeFile(source, bytes);
    const data = parseEaFile(bytes, options);
    firstTable(data).records[0].nickname = 'A';
    const result = await writeEaFile(source, output, data);
    assert.equal(result.path, output); assert.equal(result.byteLength, bytes.length);
    assert.equal(firstTable(parseEaFile(await readFile(output), options)).records[0].nickname, 'A');
    await assert.rejects(writeEaFile(source, output, data), code('FILE_WRITE_FAILED'));
    await assert.rejects(writeEaFile(source, source, data), code('FILE_WRITE_FAILED'));
    await assert.rejects(writeEaFile(source, directory, data, { overwrite: true }), code('FILE_WRITE_FAILED'));
    assert.deepEqual(await readFile(source), bytes);
    assert.deepEqual((await readdir(directory)).sort(), ['file.squad', 'new.squad']);
    await writeEaFile(source, source, data, { overwrite: true });
    assert.equal(firstTable(parseEaFile(await readFile(source), options)).records[0].nickname, 'A');
    await assert.rejects(writeEaFile('missing', output, data), code('FILE_READ_FAILED'));
    await assert.rejects(writeEaFile(source, output, data, { overwrite: 'yes' }), code('INVALID_OPTIONS'));
  } finally {
    assert.equal(dirname(directory).toLowerCase(), tmpdir().toLowerCase());
    assert.ok(basename(directory).startsWith('eafc-writer-'));
    await rm(directory, { recursive: true });
  }
});

for (const version of ['FC 25', 'FC 26']) {
  for (const database of ['main', 'fut', 'localization']) {
    test(`writes and fully reads bundled ${version} ${database} without modifying its source`, async () => {
      const relative = database === 'main' ? 'fifa_ng_db.db' : database === 'fut' ? 'FUT/cards_ng_db.db' : 'loc/eng_us.db';
      const url = new URL(`../templates/${version}/${relative}`, import.meta.url);
      const bytes = await readFile(url), metadata = await loadTemplateMetadata(version, database);
      const count = bytes.readInt32LE(16), base = 28 + count * 8;
      let shortName;
      for (let index = 0; index < count; index++) {
        const offset = base + bytes.readUInt32LE(28 + index * 8);
        const rows = bytes.readUInt16LE(offset + 18);
        if (rows > 0 && (rows < 2000 || database === 'localization')) { shortName = bytes.subarray(24 + index * 8, 28 + index * 8).toString(); break; }
      }
      assert.ok(shortName);
      const data = parseEaFile(bytes, { metadata, tables: [shortName] });
      const table = firstTable(data), originalCount = table.records.length;
      table.records = table.records.slice(0, -1);
      const output = serializeEaFile(bytes, data);
      const decoded = parseEaFile(output, { metadata });
      assert.equal(decoded.metadataComplete, true);
      assert.deepEqual(decoded.warnings, []);
      assert.equal(decoded.databases[0].tables.length, count);
      assert.equal(decoded.databases[0].tables.find(table => table.shortName === shortName).records.length, originalCount - 1);
      assertCrcs(output, decoded.databases[0]);
      assert.deepEqual(await readFile(url), bytes);
    });
  }
}
