import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { makeSave } from './fixtures.mjs';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../examples/read-file.mjs', import.meta.url));

test('example exports UTF-8 JSON and prevents overwriting inputs or existing exports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eafc-cli-'));
  try {
    const path = join(directory, 'file.squad');
    const output = join(directory, 'export.json');
    const original = makeSave();
    await writeFile(path, original);
    await run(process.execPath, [script, path, '--output', output]);
    const exported = await readFile(output);
    const file = JSON.parse(exported.toString('utf8'));
    assert.equal(file.source.kind, 'squad');
    assert.equal(file.databases[0].tables[0].records[0].NAME, 'Zoë');
    await assert.rejects(run(process.execPath, [script, path, '--output', output]));
    await assert.rejects(run(process.execPath, [script, path, '--output', path]));
    await assert.rejects(run(process.execPath, [script, path, '--output']));
    assert.deepEqual(await readFile(output), exported);
    assert.deepEqual(await readFile(path), original);
  } finally {
    assert.equal(dirname(directory).toLowerCase(), tmpdir().toLowerCase());
    assert.ok(basename(directory).startsWith('eafc-cli-'));
    await rm(directory, { recursive: true });
  }
});

test('example selects a version and resolves templates from another working directory', async () => {
  const input = fileURLToPath(new URL('../templates/FC 26/fifa_ng_db.db', import.meta.url));
  const { stdout } = await run(process.execPath, [script, input, '--version', 'FC 26', 'teams'], {
    cwd: tmpdir(), maxBuffer: 4 * 1024 * 1024,
  });
  const file = JSON.parse(stdout);
  assert.equal(file.metadataComplete, true);
  assert.equal(file.databases[0].tables[0].records.length, 799);
  await assert.rejects(run(process.execPath, [script, input, '--version', 'FC 24']));
  await assert.rejects(run(process.execPath, [script, input, '--version']));
});
