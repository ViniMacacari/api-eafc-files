import type { PlayerCompetitionStats, PlayerMatchEntry } from '../../domain/career-models.js';
import { BinaryReader } from '../binary/binary-reader.js';

export const playerStatsRecordSize = 73;

const entryCount = 5;
const entryOffset = 22;
const entrySize = 10;

const totals = {
  minutes: [69, 15],
  ratingTotal: [84, 12],
  goals: [108, 9],
  yellowCards: [117, 7],
  redCards: [124, 6],
  appearances: [130, 8],
  assists: [138, 8],
  manOfTheMatch: [146, 8],
  saves: [154, 8],
  goalsConceded: [162, 8],
  cleanSheets: [170, 6],
} as const;

function isStatsRecord(bytes: Uint8Array, offset: number, end: number): boolean {
  return offset + playerStatsRecordSize <= end && bytes[offset] === 0x01 && bytes[offset + 1] === 0x01;
}

function matchEntry(reader: BinaryReader, offset: number): PlayerMatchEntry | null {
  const date = reader.integer(offset, 3, 25, 0);
  if (date === 0) return null;
  const minutes = reader.integer(offset, 35, 7, 0);
  const rating = reader.integer(offset, 42, 7, 0);
  const position = reader.integer(offset, 64, 6, 0);
  return {
    date,
    played: minutes > 0,
    minutes,
    rating: minutes > 0 && rating > 0 ? rating / 10 : null,
    goals: reader.integer(offset, 50, 3, 0),
    position: position === 0 ? null : position - 1,
  };
}

export function parsePlayerStats(bytes: Uint8Array, start: number, end: number): PlayerCompetitionStats[] {
  const reader = new BinaryReader(bytes, 'little', start, end);
  const stats: PlayerCompetitionStats[] = [];
  for (let index = 0, offset = start; isStatsRecord(bytes, offset, end); index++, offset += playerStatsRecordSize) {
    const playerId = reader.integer(offset, 34, 19, 0) - 1;
    if (playerId < 0) continue;
    const value = (field: keyof typeof totals): number => reader.integer(offset, totals[field][0], totals[field][1], 0);
    const appearances = value('appearances');
    const ratingTotal = value('ratingTotal');
    const recentMatches: PlayerMatchEntry[] = [];
    for (let entry = 0; entry < entryCount; entry++) {
      const match = matchEntry(reader, offset + entryOffset + entry * entrySize);
      if (match) recentMatches.push(match);
    }
    stats.push({
      index,
      playerId,
      teamId: reader.integer(offset, 16, 18, 0) - 1,
      competitionId: reader.integer(offset, 53, 11, 0),
      appearances,
      minutes: value('minutes'),
      goals: value('goals'),
      assists: value('assists'),
      yellowCards: value('yellowCards'),
      redCards: value('redCards'),
      manOfTheMatch: value('manOfTheMatch'),
      cleanSheets: value('cleanSheets'),
      goalsConceded: value('goalsConceded'),
      saves: value('saves'),
      ratingTotal,
      averageRating: appearances > 0 ? Math.round(ratingTotal / appearances * 10) / 100 : null,
      recentMatches: recentMatches.sort((a, b) => a.date - b.date),
    });
  }
  return stats;
}
