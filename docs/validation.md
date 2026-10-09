# Validation

Integration tests use bundled `templates/` files without external paths. [validation.json](validation.json) records current SHA-256 checksums.

On October 9, 2026, `npm run check` passed type checking, compilation, and **33 tests**, with no failures or skipped tests. Package inventory checks also confirmed inclusion of all local XML descriptors and databases.

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

Integrations are mandatory because templates are part of the project. Template changes require updating the inventory and integration expectations.

## Evidence limits

Bundled files are database/XML templates. Squad and career container decoding is covered by binary fixtures. Encrypted containers, external compression, and other version signatures have not been validated. CRCs and areas outside DB databases are not interpreted.
