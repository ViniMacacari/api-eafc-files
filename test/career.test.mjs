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
    section('stndgs', Buffer.alloc(4)),
  ]);
}

test('locates named career sections', () => {
  const career = parseCareerData(makeCareer());
  assert.deepEqual(career.sections.map(item => item.name), ['version', 'compavg', 'compobj', 'teams', 'fixture', 'stagadv', 'stndgs']);
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
