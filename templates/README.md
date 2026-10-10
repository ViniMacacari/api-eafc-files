# Local templates

Template files are included in both the project and the package. Available versions: **FC 25** and **FC 26**.

```text
templates/
  FIFA.xml
  FC 25/
    fifa_ng_db.db
    fifa_ng_db-meta.xml
    FUT/
      cards_ng_db.db
      cards_ng_db-meta.xml
    loc/
      eng_us.db
      eng_us-meta.xml
  FC 26/
    fifa_ng_db.db
    fifa_ng_db-meta.xml
    FUT/
      cards_ng_db.db
      cards_ng_db-meta.xml
    loc/
      eng_us.db
      eng_us-meta.xml
```

The collection contains six database/XML pairs and the auxiliary `FIFA.xml` file. Database bytes are preserved. XML comments have been removed without changing active descriptor elements. `FIFA.xml` describes auxiliary table references and is not used as a binary descriptor by the reader.

Bundled databases can also be used as source binaries for the [write API](../docs/writing.md). Write to a new destination to keep the bundled files and their checksum inventory unchanged.

`readEaFile(path, { version: 'FC 26' })` selects the main descriptor. `readTemplateDatabase({ version: 'FC 26' })` also reads the matching bundled database. Select FUT or localization with `database: 'fut'` or `'localization'`.

Names and ranges depend on the version. The API cannot automatically detect a save from another version that reuses the same field codes. Use `SUPPORTED_VERSIONS` and `TEMPLATE_DATABASES` to inspect available options.

To add a version, include its files and update `src/domain/templates.ts`, integration tests, and the validation inventory. Current file checksums are recorded in `docs/validation.json`.
