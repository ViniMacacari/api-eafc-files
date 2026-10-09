# Writing EA FC files

The write API edits a file that the reader already understands. It accepts the original binary and an `EaFile` snapshot containing the requested record values. Both FC 25 and FC 26 templates are supported. The same entry points handle standalone databases, squads, and career saves with multiple databases.

## File workflow

```ts
import { readEaFile, writeEaFile } from '../dist/index.js';

const source = 'C:/saves/CmMgrC20261009';
const data = await readEaFile(source, {
  version: 'FC 26',
  tables: ['players'],
});

const players = data.databases.flatMap(database => database.tables)
  .find(table => table.name === 'players');
if (!players) throw new Error('The players table was not found.');
const player = players.records.find(record => record.playerid === 158023);
if (!player) throw new Error('The requested player was not found.');

player.overallrating = 90;

const result = await writeEaFile(source, 'C:/saves/edited-career', data);
const written = await readEaFile(result.path, {
  version: 'FC 26',
  tables: ['players'],
});
console.log(written.source);
```

Database indexes can differ between files. Locate the desired table instead of assuming the main database is always index zero. When the same table appears in multiple databases, select the intended database explicitly using its `index` and the game's meaning for that database.

`writeEaFile(sourcePath, outputPath, file, options?)` returns a `Promise<WriteFileResult>` with an absolute `path` and the resulting `byteLength`. The source is opened read-only. The output's parent directory must already exist.

| Option | Default | Meaning |
| --- | --- | --- |
| `overwrite` | `false` | Permit replacement of an existing output path |
| `saveIntegrity` | `'invalidate'` | Reset known save integrity fields after an edit |
| `limits` | `DEFAULT_LIMITS` | Bound source parsing and output encoding |

To replace the source explicitly:

```ts
await writeEaFile(source, source, data, { overwrite: true });
```

Serialization completes before the destination is published. Invalid edits leave existing files untouched. The library writes and flushes a temporary file in the destination directory, then publishes it with an exclusive hard link when creating a new output, or a rename when replacement is enabled. Temporary files are cleaned after normal completion and handled errors. An interrupted process can leave an orphan temporary file.

The filesystem must support hard links for exclusive publication and replacement by rename for overwrites. Network shares and applications holding file locks can reject publication; the library reports `FILE_WRITE_FAILED`. Atomic publication prevents a partially written destination from becoming visible, but does not guarantee durability across every filesystem or power failure. Concurrent writes with `overwrite: true` do not provide conflict detection.

## Edit records, add rows, and delete rows

Existing record values can be assigned directly. Arrays and structural properties are read-only in the TypeScript contract; use object spreads when changing a record collection:

```ts
import type { EaFile, EaRecord } from '../dist/index.js';

const originalPlayer = players.records[0];
if (!originalPlayer) throw new Error('No player records were found.');
const newPlayer: EaRecord = { ...originalPlayer, playerid: 400000 };

const withNewPlayer: EaFile = {
  ...data,
  databases: data.databases.map(database => ({
    ...database,
    tables: database.tables.map(table => table === players
      ? { ...table, records: [...table.records, newPlayer] }
      : table),
  })),
};

await writeEaFile(source, 'C:/saves/with-new-player', withNewPlayer);
```

This assumes `players` exists, has a record to copy, and `400000` fits that file's `playerid` field. Validate those conditions for the input you are editing. A cloned player is a binary record; related game tables may also require updates.

Delete a record by replacing its table's `records` with a filtered array:

```ts
const remaining = players.records.filter(record => record.playerid !== 158023);

const withoutPlayer: EaFile = {
  ...data,
  databases: data.databases.map(database => ({
    ...database,
    tables: database.tables.map(table => table === players
      ? { ...table, records: remaining }
      : table),
  })),
};

await writeEaFile(source, 'C:/saves/without-player', withoutPlayer);
```

Every new record must contain exactly the table's declared field names and valid values. An empty `records` array empties a table. Changed tables are compacted to valid rows: `writtenRecords` becomes the new row count, `cancelledRecords` becomes zero, and capacity remains at least its original value or grows to fit the new count. No unused record slots are materialized between the written rows and the string block.

The library does not generate IDs, enforce uniqueness, maintain foreign keys, or update gameplay relationships automatically. Changes to schemas, field types, widths, offsets, database order, or the set of databases are unsupported. Do not edit field descriptors or bookkeeping properties to request a schema change; edit records instead. The supplied field names and integer minima are trusted descriptor data and must be retained from the read result.

For another edit of the written file, re-read it first. The writer does not mutate the input snapshot's sizes, counts, CRCs, or offsets. A snapshot from before a write is not a fresh snapshot of its output.

## Serialize bytes without filesystem access

```ts
import { readFile } from 'node:fs/promises';
import { loadTemplateMetadata, parseEaFile, serializeEaFile } from '../dist/index.js';

const sourceBytes = await readFile('C:/saves/file.squad');
const metadata = await loadTemplateMetadata('FC 26');
const data = parseEaFile(sourceBytes, { metadata, tables: ['teams'] });
const teams = data.databases.flatMap(database => database.tables)
  .find(table => table.name === 'teams');
if (!teams?.records[0]) throw new Error('No team records were found.');

teams.records[0].teamname = 'New team';
const outputBytes = serializeEaFile(sourceBytes, data);
```

`serializeEaFile(sourceBytes, file, options?)` returns a new `Uint8Array`. It performs no I/O and never modifies the source bytes or the input object. `Buffer` inputs and typed-array slices with a nonzero `byteOffset` are supported. Options are `limits` and `saveIntegrity`; overwrite is a filesystem concern.

An unchanged snapshot produces byte-identical output, including existing CRCs and save integrity bytes. Diagnostic properties such as warning text are not binary edits. Selected table names and integer ranges come from the descriptors included in the snapshot. Reads without descriptors can also be written, using their short codes and raw integer interpretation.

## Import an edited JSON snapshot

```ts
import { readFile } from 'node:fs/promises';
import { writeEaFile } from '../dist/index.js';
import type { EaFile } from '../dist/index.js';

const edited = JSON.parse(await readFile('edited.json', 'utf8')) as EaFile;
await writeEaFile('C:/saves/file.squad', 'C:/saves/edited.squad', edited);
```

The cast does not validate JSON. The writer validates file structure, records, field values, and source compatibility at runtime. JSON must retain the complete `EaFile` envelope from a read or export, including database identity, selected table descriptors, and source byte length. Opaque container bytes are not present in JSON, so the original binary remains required.

The matching command-line workflow is:

```powershell
npm run read -- "C:/saves/file.squad" --version "FC 26" teams --output teams.json
npm run write -- "C:/saves/file.squad" teams.json "C:/saves/edited.squad"
```

Edit `teams.json` between those commands. The write example reads the JSON snapshot into memory, uses the public write API, and exits. `--overwrite` allows replacement; `--save-integrity preserve` changes the integrity policy. No server is started.

## Preservation and allocation rules

| Area | Write behavior |
| --- | --- |
| Source input | Never mutated by serialization |
| Unchanged file | Byte-identical copy |
| Unselected tables | Preserve descriptors and record bytes; their CRCs may be refreshed if their database changes |
| Unchanged databases | Preserve their entire original byte span |
| Changed tables | Retain descriptor order and structural header bytes; rebuild valid rows and strings |
| Existing row gaps and reserved bytes | Retain from the original valid row at the same ordinal position |
| New row gaps | Initialize to zero |
| Standalone database | Rebuild offsets and permit size changes; retain any trailing bytes outside the database |
| Database inside a save | Keep its original offset and total byte length |
| Opaque save areas and gaps | Preserve except for explicitly handled name and integrity areas |

When a changed save database becomes smaller, the writer pads its final table's CRC-covered body to keep the original database allocation. If the rebuilt database becomes larger, serialization fails with `INVALID_WRITE`; neighboring save structures are not relocated. Deleted rows and string deduplication can free space, but additions and longer strings are not guaranteed to fit.

Row identity is its position in the returned valid-record array. The reader omits cancelled rows. Reordering or deleting rows reassigns retained gap bytes by ordinal position; the library cannot infer ownership of undocumented per-row data. Known fields are encoded from the supplied records.

The binary and snapshot must belong to the same source layout. Structural validation is not a cryptographic identity check or a concurrent-edit detector. Keep the original source unchanged between reading and writing, especially when replacing files.

## Field validation

| Type | Accepted values |
| --- | --- |
| Integer | Signed Int32 numbers whose unsigned difference from `rangeLow` fits `depth` bits |
| Float | Finite numbers representable as finite float32 values |
| Fixed string | Well-formed UTF-8 that fits `depth / 8` bytes, without embedded null characters |
| Short compressed string | Well-formed UTF-8 of at most 255 bytes, without embedded null characters |
| Long compressed string | Well-formed UTF-8 of at most 65,535 bytes, without embedded null characters |

String limits count UTF-8 bytes, not JavaScript characters. Strings are never silently truncated. An empty compressed string uses pointer `-1`. Changed tables receive a deterministic Huffman tree built from the strings being written, allowing Unicode symbols that were absent from the original tree. Repeated strings share pointers when their length-prefix types match.

Integer encoding follows the reader's signed 32-bit wrap behavior; `rangeHigh` remains descriptive metadata while the binary bit depth controls storage. Float32 rounding is expected. Existing non-finite float values appear as `null` in JSON; unchanged values preserve their original bits. Assigning `null` to a new float or to a previously finite float is rejected. Adding or moving a row containing `null` may require supplying a finite value.

Missing fields, extra fields, malformed Unicode, incompatible layouts, overlapping fields, and values setting a record's cancellation bit produce `INVALID_WRITE`. Tables cannot exceed 65,535 valid rows. Source parsing and output encoding also enforce `DEFAULT_LIMITS` or supplied overrides, producing `LIMIT_EXCEEDED` when exceeded.

## CRCs and save integrity

Changed databases recalculate the database header CRC, directory CRC, each table header CRC, and each table body CRC. The algorithm is CRC-32/MPEG-2: polynomial `0x04C11DB7`, initial value `0xFFFFFFFF`, no reflection, and no final XOR. CRC integers use the database's byte order. Table-body coverage includes descriptors, records, strings, and padding before the final CRC.

For edited `FBCHUNKS` saves, the default `saveIntegrity: 'invalidate'` resets the same integrity areas handled by the local C# write path: 32 bytes at offset 118, 16 bytes at offset 218, and 16 bytes at offset 1142. These areas must precede the first database. Other header formats are preserved because their integrity layout is unknown. An unchanged file does not reset these areas.

Use `'preserve'` only when a surrounding workflow intentionally handles save integrity separately. Preserving old integrity bytes does not recalculate outer save signatures. Renaming `inGameName` uses the existing null-padded allocation starting at byte 18 and accepts Latin-1 characters, matching the reader's container-name interpretation. For `FBCHUNKS`, names must end before the reserved area at byte 118, giving at most 99 characters plus the null terminator.

## Verification and compatibility

Automated tests cover both byte orders, all supported field types, raw and Huffman inputs, Unicode additions, CRCs checked with an independent bitwise implementation, record additions and deletions, filtered reads, opaque regions, save allocations, invalid values, filesystem failures, and all six bundled databases. Each edited bundled database is fully decoded after serialization.

Additional local smoke checks edited and re-read FC 26 squad, online squad, and career files while preserving source files and database offsets. These files are not bundled or required by tests. Validation demonstrates binary round trips and the referenced write-format behavior; launching the edited files in the game has not been verified.

Writing encrypted or externally compressed containers, changing schemas, relocating save databases, and rebuilding unknown outer container signatures are unsupported. See [validation](validation.md) and [binary format](binary-format.md) for further details.
