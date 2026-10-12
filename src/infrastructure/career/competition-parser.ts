import type { CompetitionLevel, CompetitionNode } from '../../domain/career-models.js';
import { BinaryReader } from '../binary/binary-reader.js';

export const competitionRecordSize = 49;

const levels: Readonly<Record<number, CompetitionLevel>> = {
  1: 'confederation', 2: 'nation', 3: 'competition', 4: 'stage', 5: 'group',
};

function isPrintable(bytes: Uint8Array, start: number, length: number): boolean {
  const zero = bytes.subarray(start, start + length).indexOf(0);
  const end = zero === -1 ? start + length : start + zero;
  for (let i = start; i < end; i++) if (bytes[i]! < 0x20 || bytes[i]! > 0x7e) return false;
  return true;
}

function isCompetitionRecord(bytes: Uint8Array, offset: number, end: number): boolean {
  if (offset + competitionRecordSize > end || bytes[offset] !== 0xff || bytes[offset + 1] !== 0x01) return false;
  const id = bytes[offset + 2]! | bytes[offset + 3]! << 8;
  const copy = bytes[offset + 4]! | bytes[offset + 5]! << 8;
  const level = bytes[offset + 6]!;
  return id === copy && level >= 1 && level <= 9 && isPrintable(bytes, offset + 9, 7) && isPrintable(bytes, offset + 16, 33);
}

export function parseCompetitions(bytes: Uint8Array, start: number, end: number): CompetitionNode[] {
  let offset = start;
  while (offset < end && !(isCompetitionRecord(bytes, offset, end) && isCompetitionRecord(bytes, offset + competitionRecordSize, end))) offset++;
  if (offset >= end) return [];
  const reader = new BinaryReader(bytes, 'little', start, end);
  const nodes: CompetitionNode[] = [];
  for (; isCompetitionRecord(bytes, offset, end); offset += competitionRecordSize) {
    const id = reader.u16(offset + 2);
    if (nodes.length > 0 && id !== nodes.at(-1)!.id + 1) break;
    const levelCode = reader.u8(offset + 6);
    const parentId = reader.u16(offset + 7);
    nodes.push({
      id,
      parentId: parentId === 0 || parentId === 0xffff ? null : parentId,
      level: levels[levelCode] ?? 'unknown',
      levelCode,
      code: reader.text(offset + 9, 7, true),
      nameKey: reader.text(offset + 16, 33, true),
    });
  }
  return nodes;
}
