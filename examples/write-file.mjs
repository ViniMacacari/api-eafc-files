import { readFile } from 'node:fs/promises';
import { EaFileError, writeEaFile } from '../dist/index.js';

const args = process.argv.slice(2);
const overwriteIndex = args.indexOf('--overwrite');
const overwrite = overwriteIndex !== -1;
if (overwrite) args.splice(overwriteIndex, 1);
const integrityIndex = args.indexOf('--save-integrity');
const saveIntegrity = integrityIndex === -1 ? undefined : args.splice(integrityIndex, 2)[1];
const [source, json, output] = args;
if (args.length !== 3 || !source || !json || !output) {
  process.stderr.write('Usage: npm run write -- <source> <edited.json> <output> [--overwrite] [--save-integrity invalidate|preserve]\n');
  process.exitCode = 1;
} else {
  try {
    if (integrityIndex !== -1 && !saveIntegrity) throw new EaFileError('INVALID_OPTIONS', '--save-integrity requires a value.');
    const data = JSON.parse(await readFile(json, 'utf8'));
    const result = await writeEaFile(source, output, data, { overwrite, ...(saveIntegrity ? { saveIntegrity } : {}) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(error instanceof EaFileError ? error.toJSON() : { message: String(error) })}\n`);
    process.exitCode = 1;
  }
}
