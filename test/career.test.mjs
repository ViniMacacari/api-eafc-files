import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { EaFileError, parseCareerData, rankStandings, readCareerData } from '../dist/index.js';
import { makeDatabase, makeSave } from './fixtures.mjs';

const code = expected => error => error instanceof EaFileError && error.code === expected;

function section(name, body) {
  const header = Buffer.alloc(4 + name.length + 2);
  header.writeUInt32LE(name.length, 0);
  header.write(name, 4, 'latin1');
  header[4 + name.length] = 1;
  return Buffer.concat([header, body]);
}

function marker(name, body) {
  const header = Buffer.alloc(4 + name.length);
  header.writeUInt32LE(name.length, 0);
  header.write(name, 4, 'latin1');
  return Buffer.concat([header, body]);
}

function competition(id, level, parent, codeText, key) {
  const record = Buffer.alloc(49);
  record.set([0xff, 0x01]);
  record.writeUInt16LE(id, 2); record.writeUInt16LE(id, 4);
  record[6] = level; record.writeUInt16LE(parent, 7);
  record.write(codeText, 9, 'latin1'); record.write(key, 16, 'latin1');
  return record;
}

function standing(index, group, team, slot, home, away, points) {
  const record = Buffer.alloc(23);
  record.set([0xff, 0x01]);
  record.writeUInt16LE(index, 2); record.writeUInt16LE(group, 4); record.writeInt32LE(team, 6);
  record[10] = slot; record.set(home, 11); record.set(away, 16); record[21] = points;
  return record;
}

function fixture(index, competitionId, round, date, time, home, away, played) {
  const record = Buffer.alloc(22);
  record.set([0xff, 0x01]);
  record.writeUInt16LE(index, 2); record.writeUInt16LE(competitionId, 4); record[6] = round;
  record.writeUInt32LE(date, 7); record.writeUInt16LE(time, 11);
  record.writeUInt16LE(home[0], 13); record[15] = home[1]; record[16] = 0xff;
  record.writeUInt16LE(away[0], 17); record[19] = away[1]; record[20] = 0xff;
  record[21] = played ? 1 : 0;
  return record;
}

function setBits(bytes, offset, width, value) {
  for (let bit = 0; bit < width; bit++) {
    const position = offset + bit;
    if (Math.floor(value / 2 ** bit) % 2 === 1) bytes[position >> 3] |= 1 << (position & 7);
  }
}

function statsRecord({ team = 0, player = 0, competition = 0, totals = {}, entries = [] } = {}) {
  const record = Buffer.alloc(73);
  record.set([0x01, 0x01]);
  if (player > 0) {
    setBits(record, 16, 18, team + 1);
    setBits(record, 34, 19, player + 1);
    setBits(record, 53, 11, competition);
  }
  const layout = {
    minutes: [69, 15], ratingTotal: [84, 12], goals: [108, 9], yellowCards: [117, 7], redCards: [124, 6], appearances: [130, 8],
    assists: [138, 8], manOfTheMatch: [146, 8], saves: [154, 8], goalsConceded: [162, 8], cleanSheets: [170, 6],
  };
  for (const [field, value] of Object.entries(totals)) setBits(record, ...layout[field], value);
  for (const [slot, entry] of entries.entries()) {
    const offset = (22 + slot * 10) * 8;
    if (!entry) {
      record[22 + slot * 10] = 0x04;
      continue;
    }
    setBits(record, offset, 3, 0);
    setBits(record, offset + 3, 25, entry.date);
    setBits(record, offset + 32, 1, 1);
    setBits(record, offset + 35, 7, entry.minutes);
    setBits(record, offset + 42, 7, entry.rating);
    setBits(record, offset + 50, 3, entry.goals);
    setBits(record, offset + 64, 6, entry.position + 1);
  }
  return record;
}

export function makeCareer() {
  const competitions = Buffer.concat([
    competition(10, 1, 0, 'CONF', 'Confederation'),
    competition(11, 2, 10, 'NATN', 'NationName_1'),
    competition(12, 3, 11, 'C80', 'TrophyName_Abbr15_80'),
    competition(13, 4, 12, 'S1', 'FCE_League_Stage'),
    competition(14, 5, 13, 'G1', ''),
  ]);
  const standings = Buffer.concat([
    standing(1, 14, 100, 0, [1, 0, 0, 3, 1], [0, 1, 0, 1, 1], 4),
    standing(2, 14, 200, 1, [1, 0, 0, 2, 0], [1, 0, 0, 2, 1], 6),
    standing(3, 14, 300, 2, [0, 1, 0, 1, 1], [0, 0, 1, 0, 2], 1),
    standing(4, 99, -1, 0, [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 0),
  ]);
  const fixtures = Buffer.concat([
    fixture(1, 12, 1, 20280126, 1930, [1, 3], [3, 1], true),
    fixture(2, 12, 2, 20280202, 1600, [2, 0], [1, 0], false),
  ]);
  return Buffer.concat([
    makeSave([makeDatabase()]),
    section('version', Buffer.alloc(8)),
    section('compavg', Buffer.concat([Buffer.alloc(5), competitions])),
    section('compobj', Buffer.alloc(4)),
    section('teams', Buffer.concat([Buffer.from([0xff, 0x01, 0, 0]), fixtures])),
    section('fixture', Buffer.alloc(4)),
    section('stagadv', Buffer.concat([Buffer.alloc(3), standings])),
    marker('stndgs', Buffer.concat([
      statsRecord({
        team: 100, player: 240332, competition: 12,
        totals: { appearances: 2, minutes: 150, ratingTotal: 152, goals: 13, assists: 7, yellowCards: 1, redCards: 1, manOfTheMatch: 1,
          cleanSheets: 1, goalsConceded: 3 },
        entries: [{ date: 20280202, minutes: 0, rating: 0, goals: 0, position: 25 }, { date: 20280126, minutes: 90, rating: 82, goals: 3, position: 25 }, null],
      }),
      statsRecord(),
      statsRecord({ team: 300, player: 263821, competition: 12, totals: { appearances: 1, minutes: 90, ratingTotal: 64, saves: 7, goalsConceded: 3 } }),
    ])),
    section('stats', Buffer.alloc(4)),
  ]);
}

test('locates named career sections', () => {
  const career = parseCareerData(makeCareer());
  assert.deepEqual(career.sections.map(item => item.name), ['version', 'compavg', 'compobj', 'teams', 'fixture', 'stagadv', 'stndgs', 'stats']);
  assert.equal(career.formatVersion, 1);
  assert.equal(career.source.fileName, null);
});

test('decodes the competition tree', () => {
  const { competitions } = parseCareerData(makeCareer());
  assert.deepEqual(competitions.map(node => [node.id, node.level, node.parentId]), [
    [10, 'confederation', null], [11, 'nation', 10], [12, 'competition', 11], [13, 'stage', 12], [14, 'group', 13],
  ]);
  assert.deepEqual(competitions[2], { id: 12, parentId: 11, level: 'competition', levelCode: 3, code: 'C80', nameKey: 'TrophyName_Abbr15_80' });
});

test('decodes standings with home and away splits', () => {
  const { standings } = parseCareerData(makeCareer());
  assert.equal(standings.length, 4);
  assert.deepEqual(standings[0], {
    index: 1, groupId: 14, teamId: 100, slot: 0,
    home: { wins: 1, draws: 0, losses: 0, goalsFor: 3, goalsAgainst: 1 },
    away: { wins: 0, draws: 1, losses: 0, goalsFor: 1, goalsAgainst: 1 },
    points: 4,
  });
  assert.equal(standings[3].teamId, null);
});

test('ranks a group by points, wins, goal difference, and goals scored', () => {
  const table = rankStandings(parseCareerData(makeCareer()).standings, 14);
  assert.deepEqual(table.map(row => [row.position, row.teamId, row.played, row.points, row.goalDifference]), [
    [1, 200, 2, 6, 3], [2, 100, 2, 4, 2], [3, 300, 2, 1, -2],
  ]);
  assert.deepEqual(rankStandings(parseCareerData(makeCareer()).standings, 99), []);
});

test('decodes played and scheduled fixtures through standing slots', () => {
  const { fixtures } = parseCareerData(makeCareer());
  assert.equal(fixtures.length, 2);
  assert.deepEqual(fixtures[0], {
    index: 1, competitionId: 12, groupId: 14, round: 1, date: 20280126, time: 1930, played: true,
    home: { standingIndex: 1, teamId: 100, goals: 3, penalties: null },
    away: { standingIndex: 3, teamId: 300, goals: 1, penalties: null },
  });
  assert.equal(fixtures[1].played, false);
  assert.equal(fixtures[1].home.goals, null);
  assert.equal(fixtures[1].away.teamId, 100);
});

test('decodes player statistics per competition', () => {
  const { playerStats } = parseCareerData(makeCareer());
  assert.equal(playerStats.length, 2);
  assert.deepEqual(playerStats[0], {
    index: 0, playerId: 240332, teamId: 100, competitionId: 12,
    appearances: 2, minutes: 150, goals: 13, assists: 7, yellowCards: 1, redCards: 1, manOfTheMatch: 1,
    cleanSheets: 1, goalsConceded: 3, saves: 0, ratingTotal: 152, averageRating: 7.6,
    recentMatches: [
      { date: 20280126, played: true, minutes: 90, rating: 8.2, goals: 3, position: 25 },
      { date: 20280202, played: false, minutes: 0, rating: null, goals: 0, position: 25 },
    ],
  });
  assert.deepEqual([playerStats[1].index, playerStats[1].playerId, playerStats[1].saves, playerStats[1].averageRating, playerStats[1].recentMatches],
    [2, 263821, 7, 6.4, []]);
});

test('rejects files without career sections and enforces limits', () => {
  assert.throws(() => parseCareerData(makeSave()), code('INVALID_FORMAT'));
  assert.throws(() => parseCareerData(makeCareer(), { limits: { maxFileBytes: 10 } }), code('LIMIT_EXCEEDED'));
  assert.throws(() => parseCareerData(makeCareer(), { limits: { maxTotalRecords: 3 } }), code('LIMIT_EXCEEDED'));
});

test('reads career data from disk with the file name', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eafc-career-'));
  try {
    const path = join(directory, 'CmMgrC20280126');
    await writeFile(path, makeCareer());
    const career = await readCareerData(path);
    assert.equal(career.source.fileName, 'CmMgrC20280126');
    assert.equal(career.fixtures.length, 2);
    await assert.rejects(readCareerData(join(directory, 'missing')), code('FILE_READ_FAILED'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
