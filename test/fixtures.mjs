export const fixtureMetadata = {
  tables: [{ shortName: 'TEST', name: 'players', fields: [
    { shortName: 'ID__', name: 'playerid', rangeLow: -1, rangeHigh: 30 },
    { shortName: 'GAP_', name: 'birthdate', rangeLow: 100, rangeHigh: 2147 },
    { shortName: 'FLT_', name: 'rating', rangeLow: 0, rangeHigh: null },
    { shortName: 'NAME', name: 'name', rangeLow: 0, rangeHigh: null },
    { shortName: 'SHRT', name: 'nickname', rangeLow: 0, rangeHigh: null },
    { shortName: 'LONG', name: 'description', rangeLow: 0, rangeHigh: null },
    { shortName: 'SGND', name: 'signed', rangeLow: 0, rangeHigh: 2147483647 },
  ] }],
};

export function makeDatabase({ big = false, rawStrings = false, allNull = false, capacity = 4 } = {}) {
  const fields = [
    ['NAME', 0, 64, 64], ['ID__', 3, 0, 5], ['LONG', 14, 160, 32],
    ['GAP_', 3, 13, 11], ['FLT_', 4, 32, 32], ['SHRT', 13, 128, 32], ['SGND', 3, 192, 32],
  ];
  const nameBytes = Buffer.from('Zoë');
  let pool;
  let shortPointer;
  let longPointer;
  if (allNull) {
    pool = Buffer.alloc(0); shortPointer = -1; longPointer = -1;
  } else if (rawStrings) {
    const longBytes = Buffer.from('Hello 🌍');
    const prefix = Buffer.alloc(2);
    if (big) prefix.writeUInt16LE(longBytes.length); else prefix.writeUInt16BE(longBytes.length);
    pool = Buffer.concat([Buffer.from([nameBytes.length]), nameBytes, prefix, longBytes]);
    shortPointer = 0; longPointer = nameBytes.length + 1;
  } else {
    pool = Buffer.from([0, 65, 1, 0, 0, 66, 0, 67, 3, 0x58, ...(big ? [3, 0] : [0, 3]), 0xD0]);
    shortPointer = 8; longPointer = 10;
  }
  const recordSize = 29, rows = 3;
  const db = Buffer.alloc(36 + 36 + 16 * fields.length + recordSize * rows + pool.length + 4);
  const write32 = (value, offset) => big ? db.writeInt32BE(value, offset) : db.writeInt32LE(value, offset);
  const write16 = (value, offset) => big ? db.writeUInt16BE(value, offset) : db.writeUInt16LE(value, offset);
  db.set([0x44, 0x42, 0, 8, Number(big), 0, 0, 0]);
  write32(db.length, 8); write32(1, 16); write32(123, 20);
  db.write('TEST', 24); write32(0, 28); write32(456, 32);
  const table = 36;
  write32(recordSize, table + 4); write32(recordSize * 8 - 1, table + 8); write32(pool.length, table + 12);
  write16(capacity, table + 16); write16(rows, table + 18); write16(1, table + 20);
  db[table + 24] = fields.length; write32(789, table + 32);
  for (const [i, [code, type, bit, depth]] of fields.entries()) {
    const offset = table + 36 + i * 16;
    write32(type, offset); write32(bit, offset + 4); db.write(code, offset + 8); write32(depth, offset + 12);
  }
  const records = table + 36 + fields.length * 16;
  for (let row = 0; row < rows; row++) {
    const offset = records + row * recordSize;
    db.set(big ? [0x88, 0x04, 0x01, 0] : [0x11, 0x20, 0x80, 0], offset);
    if (big) db.writeFloatBE(1.5, offset + 4); else db.writeFloatLE(1.5, offset + 4);
    db.set(nameBytes, offset + 8);
    write32(row === 2 ? -1 : shortPointer, offset + 16);
    write32(row === 2 ? -1 : longPointer, offset + 20);
    write32(-1, offset + 24);
    if (row === 1) db[offset + recordSize - 1] = 0x80;
  }
  db.set(pool, records + recordSize * rows);
  return db;
}

export function makeSave(databases = [makeDatabase()], name = 'Test career') {
  const header = Buffer.alloc(96);
  header.write(name, 18, 'latin1');
  return Buffer.concat([header, ...databases.flatMap((db) => [db, Buffer.alloc(7)])]);
}

export const expectedRow = {
  playerid: 16, birthdate: 1125, rating: 1.5, name: 'Zoë', nickname: 'ABC', description: 'CAB', signed: -1,
};
