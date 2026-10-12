import type { Fixture, FixtureSide, StandingEntry } from '../../domain/career-models.js';
import { BinaryReader } from '../binary/binary-reader.js';

export const fixtureRecordSize = 22;

function isDate(value: number): boolean {
  const month = Math.trunc(value / 100) % 100;
  const day = value % 100;
  return value >= 19000101 && value <= 29991231 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function isFixtureRecord(reader: BinaryReader, offset: number, end: number, standings: ReadonlyMap<number, StandingEntry>,
  competitions: ReadonlySet<number>): boolean {
  if (offset + fixtureRecordSize > end || reader.bytes[offset] !== 0xff || reader.bytes[offset + 1] !== 0x01) return false;
  const time = reader.u16(offset + 11);
  return reader.u8(offset + 21) <= 1 && time % 100 < 60 && time < 2400 && isDate(reader.u32(offset + 7)) &&
    competitions.has(reader.u16(offset + 4)) && standings.has(reader.u16(offset + 13)) && standings.has(reader.u16(offset + 17));
}

function side(reader: BinaryReader, offset: number, played: boolean, standings: ReadonlyMap<number, StandingEntry>): FixtureSide {
  const standingIndex = reader.u16(offset);
  const goals = reader.u8(offset + 2);
  const penalties = reader.u8(offset + 3);
  return {
    standingIndex,
    teamId: standings.get(standingIndex)?.teamId ?? null,
    goals: played && goals !== 0xff ? goals : null,
    penalties: played && penalties !== 0xff ? penalties : null,
  };
}

export function parseFixtures(bytes: Uint8Array, start: number, end: number, standings: readonly StandingEntry[],
  competitionIds: ReadonlySet<number>): Fixture[] {
  const byIndex = new Map(standings.map((entry) => [entry.index, entry]));
  const reader = new BinaryReader(bytes, 'little', start, end);
  const fixtures: Fixture[] = [];
  for (let offset = start; offset < end;) {
    if (!isFixtureRecord(reader, offset, end, byIndex, competitionIds)) {
      offset++;
      continue;
    }
    const played = reader.u8(offset + 21) === 1;
    const home = side(reader, offset + 13, played, byIndex);
    fixtures.push({
      index: reader.u16(offset + 2),
      competitionId: reader.u16(offset + 4),
      groupId: byIndex.get(home.standingIndex)!.groupId,
      round: reader.u8(offset + 6),
      date: reader.u32(offset + 7),
      time: reader.u16(offset + 11),
      played,
      home,
      away: side(reader, offset + 17, played, byIndex),
    });
    offset += fixtureRecordSize;
  }
  return fixtures;
}
