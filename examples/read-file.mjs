import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { EaFileError, SUPPORTED_VERSIONS, eaFileJsonChunks, readEaFile } from '../dist/index.js';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex === -1 ? undefined : args.splice(outputIndex, 2)[1];
const versionIndex = args.indexOf('--version');
const version = versionIndex === -1 ? undefined : args.splice(versionIndex, 2)[1];
const databaseIndex = args.indexOf('--database');
const database = databaseIndex === -1 ? undefined : args.splice(databaseIndex, 2)[1];
const [filePath, ...tables] = args;
if (!filePath) {
  process.stderr.write(`Usage: npm run read -- <file> --version "${SUPPORTED_VERSIONS.join(' | ')}" [--database main|fut|localization] [table ...] [--output new.json]\n`);
  process.exitCode = 1;
} else {
  try {
    if (outputIndex !== -1 && !outputPath) throw new EaFileError('INVALID_OPTIONS', '--output requires a path.');
    if (versionIndex !== -1 && !version) throw new EaFileError('INVALID_OPTIONS', '--version requires a version.');
    if (databaseIndex !== -1 && !database) throw new EaFileError('INVALID_OPTIONS', '--database requires a database.');
    const result = await readEaFile(filePath, {
      ...(version ? { version } : {}),
      ...(database ? { database } : {}),
      ...(tables.length ? { tables } : {}),
    });
    const output = outputPath ? createWriteStream(outputPath, { flags: 'wx', encoding: 'utf8' }) : process.stdout;
    await pipeline(Readable.from(eaFileJsonChunks(result)), output);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(error instanceof EaFileError ? error.toJSON() : { message: String(error) })}\n`);
    process.exitCode = 1;
  }
}
