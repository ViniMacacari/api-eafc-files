import type { EaFile } from '../domain/models.js';

export function* eaFileJsonChunks(file: EaFile): Generator<string, void, undefined> {
  const { databases, ...header } = file;
  yield `${JSON.stringify(header).slice(0, -1)},"databases":[`;
  for (let dbIndex = 0; dbIndex < databases.length; dbIndex++) {
    if (dbIndex > 0) yield ',';
    const { tables, ...database } = databases[dbIndex]!;
    yield `${JSON.stringify(database).slice(0, -1)},"tables":[`;
    for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
      if (tableIndex > 0) yield ',';
      const { records, ...table } = tables[tableIndex]!;
      yield `${JSON.stringify(table).slice(0, -1)},"records":[`;
      for (let row = 0; row < records.length; row++) {
        if (row > 0) yield ',';
        yield JSON.stringify(records[row]);
      }
      yield ']}';
    }
    yield ']}';
  }
  yield ']}';
}
