import type { CompetitionSetting, CompetitionTask } from '../../domain/career-models.js';
import { BinaryReader } from '../binary/binary-reader.js';

export const settingRecordSize = 9;
export const taskRecordSize = 19;

function records(bytes: Uint8Array, start: number, end: number, size: number): number[] {
  const offsets: number[] = [];
  for (let offset = start; offset + size <= end && bytes[offset] === 0x01 && bytes[offset + size - 1] === 0xff; offset += size) {
    offsets.push(offset);
  }
  return offsets;
}

export function parseCompetitionSettings(bytes: Uint8Array, start: number, end: number): CompetitionSetting[] {
  const reader = new BinaryReader(bytes, 'little', start, end);
  return records(bytes, start, end, settingRecordSize).map((offset) => ({
    competitionId: reader.u16(offset + 1),
    key: reader.u8(offset + 3),
    value: reader.i32(offset + 4),
  }));
}

export function parseCompetitionTasks(bytes: Uint8Array, start: number, end: number): CompetitionTask[] {
  const reader = new BinaryReader(bytes, 'little', start, end);
  return records(bytes, start, end, taskRecordSize).map((offset) => ({
    competitionId: reader.u16(offset + 1),
    action: reader.u8(offset + 3),
    target: reader.u16(offset + 4),
    source: reader.u16(offset + 6),
    parameter: reader.u16(offset + 8),
    first: reader.i32(offset + 10),
    second: reader.i32(offset + 14),
  }));
}
