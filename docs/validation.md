# Validation

Integration tests use bundled `templates/` files without external paths. [validation.json](validation.json) records current SHA-256 checksums.

On October 12, 2026, `npm run check` passed type checking, compilation, and **71 tests**, with no failures or skipped tests. Package inventory checks also confirmed inclusion of all local XML descriptors, databases, and executable examples.

| Version | Database | Bytes | Tables | Valid records |
| --- | --- | ---: | ---: | ---: |
| FC 25 | Main | 30,322,180 | 242 | 276,444 |
| FC 26 | Main | 38,563,852 | 279 | 337,434 |
| FC 25 | FUT | 30,172,220 | 210 | 250,814 |
| FC 26 | FUT | 38,118,380 | 244 | 308,211 |
| FC 25 | Localization | 6,874,244 | 2 | 95,376 |
| FC 26 | Localization | 7,273,216 | 2 | 100,057 |

All databases were fully decoded using matching XML descriptors, with complete metadata and no warnings. Database bytes remain unchanged. XML comments were removed; the checksum inventory reflects the current files.

## Checks

`npm run check` runs type checking, compilation, and tests covering:

- Version and database selection from the local catalog.
- Complete reads of all six bundled databases.
- Template resolution from different working directories.
- Invalid versions, catalog traversal, and conflicting options.
- Extensionless squad and career containers with multiple databases.
- Both byte orders, bit gaps, signed integers, and rangelow adjustments.
- UTF-8 strings, short and long Huffman strings, raw strings, and empty pointers.
- Cancelled records, unused capacity, and empty-table sentinels.
- Truncated files, unknown types, limits, invalid XML, and Huffman cycles.
- I/O errors, input preservation, and field names such as `__proto__`.
- Incremental JSON and UTF-8 export without overwriting existing files.
- Binary writing with record edits, additions, deletions, and empty tables.
- Byte-identical serialization of unchanged raw and Huffman files.
- Rebuilt Huffman trees for new Unicode symbols and empty or single-symbol pools.
- Database and table CRCs checked against an independent bitwise implementation.
- Filtered writes, opaque byte preservation, standalone trailers, and fixed save allocations.
- Internal-name allocations and known save integrity areas.
- Invalid values, missing CRCs, zero-width records, cancellation flags, and combined decoding budgets.
- Exclusive output creation, explicit overwrite, failed publication, and temporary-file cleanup.
- Edited JSON import through the executable write example.
- Career section discovery, competition trees, standings ranking, fixtures resolved through standing slots, bit-packed player statistics, competition settings, season tasks, table zones, and career limits.

All six bundled databases were edited and fully decoded again. Source template files remained byte-identical after these checks.

Integrations are mandatory because templates are part of the project. Template changes require updating the inventory and integration expectations.

## Evidence limits

Bundled files are database/XML templates. Automated squad and career container tests use binary fixtures. Additional local FC 26 checks edited a squad, an online squad, and a career save, then re-read the resulting bytes. Source files, file lengths, and database offsets were preserved. An independent inspection also matched all **474** original table-header and table-body CRCs across those three files.

The local save files are not bundled and are not a test dependency. Loading edited saves in the game has not been verified. Encrypted containers, external compression, other version signatures, schema changes, and relocation of embedded databases are unsupported. Outer save integrity fields are invalidated or preserved according to the write option; unknown signatures are not reconstructed. See [writing](writing.md) for the exact preservation policy.
