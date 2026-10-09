import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseEaFile } from '../dist/index.js';
import { makeSave } from './fixtures.mjs';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../examples/write-file.mjs', import.meta.url));

test('write example imports edited JSON and protects existing files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eafc-write-cli-'));
  try {
    const source = join(directory, 'file.squad'), json = join(directory, 'edited.json'), output = join(directory, 'new.squad');
    const bytes = makeSave(), data = parseEaFile(bytes);
    data.databases[0].tables[0].records[0].SHRT = 'A';
    await writeFile(source, bytes); await writeFile(json, JSON.stringify(data));
    const { stdout } = await run(process.execPath, [script, source, json, output]);
    assert.equal(JSON.parse(stdout).path, output);
    assert.equal(parseEaFile(await readFile(output)).databases[0].tables[0].records[0].SHRT, 'A');
    await assert.rejects(run(process.execPath, [script, source, json, output]));
    await assert.rejects(run(process.execPath, [script, source, json, source]));
    await run(process.execPath, [script, source, json, output, '--overwrite', '--save-integrity', 'preserve']);
    await writeFile(json, '{invalid');
    await assert.rejects(run(process.execPath, [script, source, json, output, '--overwrite']));
    await assert.rejects(run(process.execPath, [script]));
    assert.deepEqual(await readFile(source), bytes);
    assert.equal(parseEaFile(await readFile(output)).databases[0].tables[0].records[0].SHRT, 'A');
  } finally {
    assert.equal(dirname(directory).toLowerCase(), tmpdir().toLowerCase());
    assert.ok(basename(directory).startsWith('eafc-write-cli-'));
    await rm(directory, { recursive: true });
  }
});
