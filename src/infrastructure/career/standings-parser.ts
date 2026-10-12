import type { StandingEntry, StandingSplit } from '../../domain/career-models.js';
import { BinaryReader } from '../binary/binary-reader.js';

export const standingRecordSize = 23;

function isStandingRecord(bytes: Uint8Array, offset: number, end: number, index: number): boolean {
  return offset + standingRecordSize <= end && bytes[offset] === 0xff && bytes[offset + 1] === 0x01 &&
    (bytes[offset + 2]! | bytes[offset + 3]! << 8) === index;
}

function split(reader: BinaryReader, offset: number): StandingSplit {
  return {
    wins: reader.u8(offset),
    draws: reader.u8(offset + 1),
    losses: reader.u8(offset + 2),
    goalsFor: reader.u8(offset + 3),
    goalsAgainst: reader.u8(offset + 4),
  };
}

export function parseStandings(bytes: Uint8Array, start: number, end: number): StandingEntry[] {
  let offset = start;
  while (offset < end && !(isStandingRecord(bytes, offset, end, 1) && isStandingRecord(bytes, offset + standingRecordSize, end, 2))) offset++;
  if (offset >= end) return [];
  const reader = new BinaryReader(bytes, 'little', start, end);
  const entries: StandingEntry[] = [];
  for (let index = 1; isStandingRecord(bytes, offset, end, index); index++, offset += standingRecordSize) {
    const teamId = reader.i32(offset + 6);
    entries.push({
      index,
      groupId: reader.u16(offset + 4),
      teamId: teamId < 0 ? null : teamId,
      slot: reader.u8(offset + 10),
      home: split(reader, offset + 11),
      away: split(reader, offset + 16),
      points: reader.u8(offset + 21),
    });
  }
  return entries;
}
