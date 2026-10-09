# JSON structure

`readEaFile` and `parseEaFile` return objects, arrays, strings, finite numbers, booleans, and `null`. Results contain no `Buffer`, `BigInt`, `Map`, or record class instances.

This contract can also be passed to `serializeEaFile` or `writeEaFile` after editing records. Preserve field descriptors and the source envelope. The original binary is required to retain data outside the JSON contract. See [writing](writing.md) for examples and source compatibility rules. The writer does not update bookkeeping properties in the supplied object; read the output to obtain current offsets and counts.

```json
{
  "formatVersion": 1,
  "source": {
    "fileName": "file.squad",
    "byteLength": 248,
    "kind": "squad"
  },
  "container": "ea-save",
  "inGameName": "My squad",
  "metadataComplete": true,
  "databases": [
    {
      "index": 0,
      "offset": 96,
      "byteLength": 145,
      "endianness": "little",
      "platform": "pc",
      "headerCrc": 0,
      "directoryCrc": 0,
      "tableCount": 1,
      "tables": [
        {
          "shortName": "TEST",
          "name": "players",
          "offset": 132,
          "recordSize": 5,
          "recordBitLimit": 39,
          "capacity": 1,
          "writtenRecords": 1,
          "cancelledRecords": 0,
          "validRecords": 1,
          "compressedStringBytes": 0,
          "headerCrc": 0,
          "metadataComplete": true,
          "fields": [
            {
              "shortName": "ID__",
              "name": "playerid",
              "type": "integer",
              "typeCode": 3,
              "bitOffset": 0,
              "depth": 32,
              "rangeLow": 0,
              "rangeHigh": 2147483647
            }
          ],
          "records": [{ "playerid": 27 }]
        }
      ]
    }
  ],
  "warnings": []
}
```

This illustrates the contract; offsets and sizes do not describe a real save.

| Property | Meaning |
| --- | --- |
| `formatVersion` | Library JSON contract version, currently `1` |
| `source.kind` | Filename classification or `options.kind` override |
| `container` | `database` for a leading DB signature; `ea-save` for an outer container |
| `inGameName` | Container header name, or `null` for standalone databases |
| `metadataComplete` | Every returned table has matching table and field descriptors |
| `databases[].offset` | Absolute database signature offset |
| `databases[].byteLength` | Declared database length relative to its signature |
| `databases[].tableCount` | Directory entry count, including filtered-out tables |
| `tables[].offset` | Absolute table header offset |
| `tables[].capacity` | Reserved record capacity |
| `tables[].writtenRecords` | Written record count declared in the header |
| `tables[].cancelledRecords` | Cancelled record count declared in the header |
| `tables[].validRecords` | Actual returned non-cancelled record count |
| `tables[].compressedStringBytes` | Raw declared size; empty tables may use `4294967295` |
| `tables[].fields` | Descriptors sorted by bitOffset |
| `tables[].records` | Valid record values in their original order |
| `fields[].rangeLow` | Applied integer minimum, or `null` when its descriptor is missing |
| `fields[].rangeHigh` | Range metadata, or `null` when absent |

Cancelled records and unwritten slots are omitted. Fixed strings end at the first zero byte. Compressed pointer `-1` returns `""`. Non-finite floats become `null` with a warning. Integers are signed 32-bit values.

Warnings do not stop decoding:

- `MISSING_METADATA`: descriptors are missing; affected integers are raw values.
- `RECORD_COUNT_MISMATCH`: cancellation bits disagree with the header count; actual bits take precedence.
- `NON_FINITE_FLOAT`: NaN or infinity was converted to `null`.

CRCs are exposed as unsigned numbers without validation or recalculation.
