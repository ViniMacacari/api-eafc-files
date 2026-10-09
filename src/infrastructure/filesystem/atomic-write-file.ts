import { randomUUID } from 'node:crypto';
import { link, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { EaFileError } from '../../domain/errors.js';

export async function atomicWriteFile(path: string, bytes: Uint8Array, overwrite: boolean): Promise<void> {
  const temporary = join(dirname(path), `.eafc-${randomUUID()}.tmp`);
  let created = false;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    created = true;
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (overwrite) await rename(temporary, path);
    else await link(temporary, path);
  } catch (error) {
    throw new EaFileError('FILE_WRITE_FAILED', `Could not write ${path}.`, undefined, error);
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    if (created) await unlink(temporary).catch(() => undefined);
  }
}
