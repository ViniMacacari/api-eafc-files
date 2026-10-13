# EA FC binary format

The reader recognizes databases with the `44 42 00 08` signature, either at the start of a file or inside an EA save container. Bundled XML descriptors provide full field names and ranges.

## EA container

The internal name starts at absolute byte offset **18**, ends at a zero byte, and contains at most 255 bytes. Each byte is converted directly to a character. Table strings use UTF-8.

The reader searches for DB signatures after the name. It advances to each database's declared end before searching again, avoiding signatures inside records. Multiple databases are supported up to `maxDatabases`.

## Database header

Offsets relative to the signature:

| Offset | Bytes | Content |
| ---: | ---: | --- |
| 0 | 8 | `44 42 00 08 P 00 00 00`; `P=0` little endian, `P=1` big endian |
| 8 | 4 | Declared database length, including the signature |
| 12 | 4 | Reserved |
| 16 | 4 | Table count |
| 20 | 4 | Header CRC |
| 24 | `8 x tables` | Directory: four-byte short code and UInt32 offset |
| After directory | 4 | Directory CRC |

Table offsets are relative to the position after the directory CRC: `dbOffset + 28 + 8 * tableCount`. Each table ends at the next physical table offset or the declared database end.

## Table header

| Offset | Bytes | Content |
| ---: | ---: | --- |
| 0 | 4 | Reserved |
| 4 | 4 | Record size |
| 8 | 4 | Declared bit limit |
| 12 | 4 | Compressed string block length |
| 16 | 2 | Capacity |
| 18 | 2 | Written record count |
| 20 | 2 | Declared cancelled record count |
| 22 | 2 | Reserved |
| 24 | 1 | Field count |
| 25 | 7 | Reserved |
| 32 | 4 | Header CRC |
| 36 | `16 x fields` | Field descriptors |

Each descriptor contains an Int32 type, Int32 bit offset, four-byte short code, and Int32 depth. Types and widths come from the binary; names and ranges come from the selected XML descriptor.

Records follow the descriptors. Only written records are examined; `0x80` in the last byte marks a cancelled record. The string block starts after these records. Zero-capacity tables do not access the block. An empty FC 25 table uses `0xFFFFFFFF` as its length sentinel.

## Fields and strings

| Code | Type | Decoding |
| ---: | --- | --- |
| 0 | `string` | `depth / 8` UTF-8 bytes, ending at the first zero |
| 3 | `integer` | `depth` bits from bitOffset, plus rangelow, as a signed Int32 |
| 4 | `float` | IEEE 754 float32 in database byte order |
| 13 | `short-compressed-string` | Int32 pointer to a one-byte length and data |
| 14 | `long-compressed-string` | Int32 pointer to a two-byte length and data |

Integers use LSB-first bits in little endian databases and MSB-first bits in big endian databases. Decoding respects gaps between field offsets. Unknown types produce `UNSUPPORTED_FIELD_TYPE`.

String pointers are relative to the compressed block start. `-1` indicates an empty string. The smallest nonempty pointer determines the Huffman tree size. Tree state is local to the table. Each node contains `child0, leaf0, child1, leaf1`; a zero child marks a leaf. Compressed data uses MSB-first bits on both platforms. A zero-size tree means uncompressed data.

The tree is limited to 256 nodes and checked for cycles and invalid child references. Long string lengths are unsigned and use the opposite byte order from the database.

## Interpretation limits

- Database boundaries, tables, fields, pointers, and decoding budgets are validated.
- Unwritten slots and cancelled records are omitted.
- Missing descriptors produce short codes and raw integer values with warnings.
- Reading exposes CRCs without validating them. Writing recalculates database and table CRCs for changed databases.
- Areas outside DB databases are not interpreted by `readEaFile`. Career competitions, standings, fixtures, and player statistics are decoded separately by `readCareerData`; see [career data](career-data.md).
- Encrypted or externally compressed containers are not decoded.
- Table filtering validates the directory and decodes selected tables only.
- `source.kind` classifies filenames; it does not reliably detect game mode or version.

The JSON result describes recognized structured databases rather than every byte of the input file.

## Writing

The writer uses the original binary and selected table records. Database and table headers retain reserved bytes and field-descriptor order. Integer bits are updated at their explicit offsets, preserving gaps; floats and pointers use database byte order. Compressed strings receive a new Huffman tree, and long-string length prefixes use the opposite byte order. String pools are padded to an eight-byte boundary before the table body CRC.

Database CRCs use polynomial `0x04C11DB7`, initial value `0xFFFFFFFF`, no reflection, and no final XOR. Header coverage is the first 20 database bytes or 32 table bytes. Directory coverage excludes its trailing CRC. Table-body coverage begins after the header CRC and ends before the final body CRC.

Standalone databases may resize. Embedded databases retain their original byte allocations and absolute offsets, preserving other save structures. Known `FBCHUNKS` integrity areas can be invalidated after edits. See [writing](writing.md) for allocation, preservation, and validation rules.
