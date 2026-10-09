import { open } from 'node:fs/promises';
import { EaFileError } from '../../domain/errors.js';

export async function readOnlyFile(path: string, maxBytes: number): Promise<Uint8Array> {
  try {
    const handle = await open(path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new EaFileError('FILE_READ_FAILED', `Path is not a file: ${path}.`);
      if (stat.size > maxBytes) throw new EaFileError('LIMIT_EXCEEDED', `File exceeds the ${maxBytes}-byte limit: ${path}.`);
      const buffer = new Uint8Array(stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0) throw new EaFileError('TRUNCATED_FILE', `File was truncated during reading: ${path}.`, offset);
        offset += bytesRead;
      }
      if ((await handle.stat()).size !== stat.size) throw new EaFileError('FILE_READ_FAILED', `File size changed during reading: ${path}.`);
      return buffer;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof EaFileError) throw error;
    throw new EaFileError('FILE_READ_FAILED', `Could not read ${path}.`, undefined, error);
  }
}
