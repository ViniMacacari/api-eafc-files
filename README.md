# api-eafc-files

A TypeScript API for reading and writing EA FC squads, career saves, and databases through JSON-compatible objects. XML descriptors and database templates are bundled in `templates/`. Reading opens inputs in read-only mode; writing creates a new output unless replacement is explicitly requested. The library does not start a server.

## Setup

Requires Node.js 24 or later. Run these commands from `api-eafc-files`:

```powershell
npm ci
npm run build
npm run check
```

The build produces ESM JavaScript and TypeScript declarations in `dist/`. `dist/` is not committed: the `prepare` script builds it when the package is installed from Git (`npm install github:ViniMacacari/api-eafc-files`). Generated code has no comments. The package includes `dist/` and `templates/`; template paths are resolved relative to the module, independently of the working directory.

## Read a squad or career save

```ts
import { readEaFile, SUPPORTED_VERSIONS } from './api-eafc-files/dist/index.js';

console.log(SUPPORTED_VERSIONS);

const data = await readEaFile('C:/saves/file.squad', {
  version: 'FC 26',
});

const players = data.databases[0]?.tables.find(table => table.name === 'players');
console.log(players?.records[0]);
```

Career saves use the same API:

```ts
const career = await readEaFile('C:/saves/CmMgrC20261009', {
  version: 'FC 26',
  tables: ['players', 'teams', 'teamplayerlinks'],
});
```

The save paths above are examples. Extensionless files are supported. `version` selects the XML descriptor explicitly; the library does not infer the game version from the filename. `source.kind` only classifies the filename and can be overridden with `kind: 'career'` or `kind: 'squad'`.

### Available versions and databases

| `version` | `database` | Selected XML inside `templates/` |
| --- | --- | --- |
| `'FC 25'` or `'FC 26'` | `'main'` (default) | `<version>/fifa_ng_db-meta.xml` |
| `'FC 25'` or `'FC 26'` | `'fut'` | `<version>/FUT/cards_ng_db-meta.xml` |
| `'FC 25'` or `'FC 26'` | `'localization'` | `<version>/loc/eng_us-meta.xml` |

The package exports immutable `SUPPORTED_VERSIONS` and `TEMPLATE_DATABASES` arrays and their corresponding `EaFcVersion` and `TemplateDatabase` types. Unknown versions or databases produce `INVALID_OPTIONS`.

Use the default `main` database for squads and career saves. Other database types can be selected explicitly:

```ts
const fut = await readEaFile('C:/saves/FutSquads20261009', {
  version: 'FC 26',
  database: 'fut',
});
```

### Read bundled databases

```ts
import { readTemplateDatabase } from './api-eafc-files/dist/index.js';

const teams = await readTemplateDatabase({
  version: 'FC 26',
  tables: ['teams'],
});

const localization = await readTemplateDatabase({
  version: 'FC 25',
  database: 'localization',
});
```

These calls load matching database and XML files from the package. No external installation paths or environment variables are required.

### Filter tables

`tables` accepts full XML names or binary short codes. Omitting it reads all tables. Databases without the requested tables return `tables: []`, while `tableCount` retains the original directory count. Unknown table names do not produce errors. Filtering reduces decoding work and memory usage.

### Read bytes and reuse descriptors

```ts
import { readFile } from 'node:fs/promises';
import { loadTemplateMetadata, parseEaFile } from './api-eafc-files/dist/index.js';

const metadata = await loadTemplateMetadata('FC 26');
const bytes = await readFile('C:/saves/file.squad');
const data = parseEaFile(bytes, { metadata, fileName: 'file.squad' });
```

`parseEaFile` is synchronous and performs no I/O. `readEaFile` and `readTemplateDatabase` load files asynchronously, but decoding runs on the calling thread. Applications can use workers for large files.

For custom descriptors, use `parseMetadataXml(xml)` and pass the result as `metadata`, without `version`. External XML paths are not accepted by the file-reading API. Without `version` or `metadata`, records use short codes and raw integer values, accompanied by `MISSING_METADATA` warnings.

## Read career standings, fixtures, competitions, and player statistics

Career saves also keep the live league tables, the season schedule with results, the competition tree, and season statistics for every player outside the databases. `leagueteamlinks` does not contain the live table and `teamplayerlinks` does not contain season statistics.

```ts
import { readCareerData, rankStandings } from './api-eafc-files/dist/index.js';

const career = await readCareerData('C:/saves/CmMgrC20261009');
const table = rankStandings(career.standings, 1530);
const nextMatches = career.fixtures.filter(fixture => !fixture.played);
const topScorers = career.playerStats
  .filter(stats => stats.competitionId === 1528)
  .sort((a, b) => b.goals - a.goals);
```

See [career data](docs/career-data.md) for linking groups to `career_users.primarycompobjid`, the result contract, and the binary layout.

## Edit and write a file

```ts
import { readEaFile, writeEaFile } from './api-eafc-files/dist/index.js';

const source = 'C:/saves/file.squad';
const data = await readEaFile(source, { version: 'FC 26', tables: ['teams'] });
const teams = data.databases.flatMap(database => database.tables)
  .find(table => table.name === 'teams');
const team = teams?.records.find(record => record.teamid === 1);
if (!team) throw new Error('Team 1 was not found.');

team.teamname = 'Arsenal FC';

const result = await writeEaFile(source, 'C:/saves/edited.squad', data);
console.log(result.path, result.byteLength);
```

Career saves use the same write API. Changes can include record edits, additions, deletions, and the container's `inGameName`. Filtered reads are supported: unselected tables and databases are retained from the source binary. The write API uses field names and integer minima already present in `data`, so no additional `version` option is needed.

The original binary is required even when `data` comes from edited JSON. Standalone databases can grow or shrink. Databases inside saves retain their original byte allocations and offsets; edits that exceed an allocation fail before any destination is published. Changed databases have their database and table CRCs recalculated. New UTF-8 symbols receive a rebuilt Huffman tree.

Existing paths are rejected by default. `overwrite: true` explicitly allows replacement, including writing back to the source path. Publication uses a temporary file in the destination directory. Re-read the output before applying a later edit because counts, offsets, and sizes in the input snapshot remain unchanged.

See the [write guide](docs/writing.md) for record insertion and deletion, binary serialization, JSON import, integrity handling, validation rules, filesystem behavior, and compatibility limits.

## JSON output and export

Results contain serializable objects and arrays. For moderate output sizes:

```ts
const json = JSON.stringify(data, null, 2);
```

For large results, use incremental serialization:

```ts
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { eaFileJsonChunks, readTemplateDatabase } from './api-eafc-files/dist/index.js';

const data = await readTemplateDatabase({ version: 'FC 26' });
await pipeline(
  Readable.from(eaFileJsonChunks(data)),
  createWriteStream('export.json', { flags: 'wx', encoding: 'utf8' }),
);
```

The generator avoids creating one string for the entire result. The input binary and decoded objects still remain in memory. Filter tables when only part of the database is needed.

The executable example also accepts a version:

```powershell
node examples/read-file.mjs `
  "templates/FC 26/fifa_ng_db.db" `
  --version "FC 26" teams --output export.json
```

Options: `--version`, `--database`, and `--output`. Without `--output`, JSON is written to stdout. Without a version, the example performs a raw read. Export creates a new file and rejects existing paths. The program exits after reading.

Import an edited JSON snapshot and create a binary file:

```powershell
npm run write -- "C:/saves/file.squad" edited.json "C:/saves/edited.squad"
```

The write example also accepts `--overwrite` and `--save-integrity invalidate|preserve`. It prints `{ "path": "...", "byteLength": ... }` after a successful write. JSON must follow the library's [output contract](docs/json-output.md); an array of records by itself is insufficient.

## Public API and errors

| Function | Return value | Purpose |
| --- | --- | --- |
| `readEaFile(path, options?)` | `Promise<EaFile>` | Read a save or database using `version` |
| `readTemplateDatabase(options)` | `Promise<EaFile>` | Read a bundled database |
| `loadTemplateMetadata(version, database?)` | `Promise<MetadataSchema>` | Load a reusable local descriptor |
| `parseEaFile(bytes, options?)` | `EaFile` | Decode a `Uint8Array` or `Buffer` |
| `serializeEaFile(sourceBytes, file, options?)` | `Uint8Array` | Apply edits to source bytes without I/O |
| `writeEaFile(sourcePath, outputPath, file, options?)` | `Promise<WriteFileResult>` | Serialize and publish a binary file |
| `parseMetadataXml(xml)` | `MetadataSchema` | Parse custom descriptor XML |
| `eaFileJsonChunks(file)` | `Generator<string>` | Generate compact JSON in chunks |
| `readCareerData(path, options?)` | `Promise<CareerData>` | Read career competitions, standings, fixtures, and player statistics |
| `parseCareerData(bytes, options?)` | `CareerData` | Decode career sections without I/O |
| `rankStandings(standings, groupId)` | `RankedStanding[]` | Rank one group by points, wins, goal difference, and goals |

`ReadFileOptions` includes `version`, `database`, `metadata`, `tables`, `fileName`, `kind`, and `limits`. `version` and `metadata` are mutually exclusive. `database` requires `version`. `ReadTemplateOptions` requires `version`. `ParseOptions` accepts `metadata` without loading XML files.

`SerializeOptions` includes `limits` and `saveIntegrity`, defaulting to `'invalidate'`. `WriteFileOptions` also includes `overwrite`, defaulting to `false`. The write options do not accept descriptor paths or a version; descriptors come from the read result.

```ts
import { EaFileError, readEaFile } from './api-eafc-files/dist/index.js';

try {
  const data = await readEaFile('C:/saves/file.squad', { version: 'FC 26' });
  console.log(data.source);
} catch (error) {
  if (error instanceof EaFileError) console.error(error.toJSON());
  else throw error;
}
```

Errors include `code`, an English `message`, and a byte `offset`, or `null` when no offset applies. Read offsets are absolute positions in the source. Codes: `INVALID_OPTIONS`, `FILE_READ_FAILED`, `FILE_WRITE_FAILED`, `INVALID_WRITE`, `INVALID_METADATA`, `INVALID_FORMAT`, `TRUNCATED_FILE`, `UNSUPPORTED_FIELD_TYPE`, `INVALID_COMPRESSED_STRING`, and `LIMIT_EXCEEDED`.

| Default limit | Value |
| --- | ---: |
| `maxFileBytes` | 268,435,456 bytes (256 MiB) |
| `maxDatabases` | 64 |
| `maxTablesPerDatabase` | 4,096 |
| `maxTotalRecords` | 1,000,000 |
| `maxDecodedValues` | 64,000,000 |
| `maxDecodedStringBytes` | 67,108,864 bytes (64 MiB) |

Override limits with `limits: { maxTotalRecords: 2_000_000 }`. Values must be positive safe integers. Defaults are exported as `DEFAULT_LIMITS`.

## Project structure

- `src/domain/`: contracts, version catalog, errors, and decoding budgets.
- `src/application/`: file reads and writes, template selection, decoding, and serialization.
- `src/infrastructure/binary/`: databases, tables, fields, bits, Huffman coding, and CRCs.
- `src/infrastructure/career/`: career sections, competition tree, standings, fixtures, and player statistics.
- `src/infrastructure/metadata/`: XML parsing and descriptor indexes.
- `src/infrastructure/templates/`: bundled template path resolution.
- `src/infrastructure/filesystem/`: read-only source access and atomic output publication.
- `templates/`: FC 25 and FC 26 descriptors and databases.
- `test/`: fixtures and integration tests using bundled templates.

The library has no mutable global state or external program dependency. TypeScript enables `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. Development references: [TypeScript configuration](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html) and [Node.js test runner](https://nodejs.org/api/test.html).

Further documentation: [career data](docs/career-data.md), [writing](docs/writing.md), [JSON structure](docs/json-output.md), [binary format](docs/binary-format.md), [templates](templates/README.md), and [validation](docs/validation.md).
