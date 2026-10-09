# api-eafc-files

A TypeScript API for reading EA FC squads, career saves, and databases as JSON-compatible objects. XML descriptors and database templates are bundled in `templates/`. Input files are opened in read-only mode. The library does not start a server.

## Setup

Requires Node.js 24 or later. Run these commands from `api-eafc-files`:

```powershell
npm ci
npm run build
npm run check
```

The build produces ESM JavaScript and TypeScript declarations in `dist/`. Generated code has no comments. The package includes `dist/` and `templates/`; template paths are resolved relative to the module, independently of the working directory.

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

## Public API and errors

| Function | Return value | Purpose |
| --- | --- | --- |
| `readEaFile(path, options?)` | `Promise<EaFile>` | Read a save or database using `version` |
| `readTemplateDatabase(options)` | `Promise<EaFile>` | Read a bundled database |
| `loadTemplateMetadata(version, database?)` | `Promise<MetadataSchema>` | Load a reusable local descriptor |
| `parseEaFile(bytes, options?)` | `EaFile` | Decode a `Uint8Array` or `Buffer` |
| `parseMetadataXml(xml)` | `MetadataSchema` | Parse custom descriptor XML |
| `eaFileJsonChunks(file)` | `Generator<string>` | Generate compact JSON in chunks |

`ReadFileOptions` includes `version`, `database`, `metadata`, `tables`, `fileName`, `kind`, and `limits`. `version` and `metadata` are mutually exclusive. `database` requires `version`. `ReadTemplateOptions` requires `version`. `ParseOptions` accepts `metadata` without loading XML files.

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

Errors include `code`, an English `message`, and an absolute byte `offset`, or `null` when no offset applies. Codes: `INVALID_OPTIONS`, `FILE_READ_FAILED`, `INVALID_METADATA`, `INVALID_FORMAT`, `TRUNCATED_FILE`, `UNSUPPORTED_FIELD_TYPE`, `INVALID_COMPRESSED_STRING`, and `LIMIT_EXCEEDED`.

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
- `src/application/`: file reads, template selection, decoding, and JSON serialization.
- `src/infrastructure/binary/`: databases, tables, fields, bits, and Huffman decoding.
- `src/infrastructure/metadata/`: XML parsing and descriptor indexes.
- `src/infrastructure/templates/`: bundled template path resolution.
- `src/infrastructure/filesystem/`: read-only file access with `open(path, 'r')`.
- `templates/`: FC 25 and FC 26 descriptors and databases.
- `test/`: fixtures and integration tests using bundled templates.

The library has no mutable global state or external program dependency. TypeScript enables `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. Development references: [TypeScript configuration](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html) and [Node.js test runner](https://nodejs.org/api/test.html).

Further documentation: [JSON structure](docs/json-output.md), [binary format](docs/binary-format.md), [templates](templates/README.md), and [validation](docs/validation.md).
