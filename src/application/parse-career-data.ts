import type { CareerData, CareerParseOptions, CareerSection } from '../domain/career-models.js';
import { EaFileError } from '../domain/errors.js';
import { resolveLimits } from '../domain/limits.js';
import { findCareerSections, sectionBounds } from '../infrastructure/career/career-sections.js';
import { parseCompetitionSettings, parseCompetitionTasks } from '../infrastructure/career/competition-rules-parser.js';
import { parseCompetitions } from '../infrastructure/career/competition-parser.js';
import { parseFixtures } from '../infrastructure/career/fixture-parser.js';
import { parsePlayerStats } from '../infrastructure/career/player-stats-parser.js';
import { parseStandings } from '../infrastructure/career/standings-parser.js';

function blockAfter(sections: readonly CareerSection[], tag: string): { start: number; end: number } | undefined {
  const bounds = sectionBounds(sections, tag);
  return bounds === undefined ? undefined : { start: bounds.start + 4 + tag.length, end: bounds.end };
}

export function parseCareerData(bytes: Uint8Array, options: CareerParseOptions = {}): CareerData {
  const limits = resolveLimits(options.limits);
  if (bytes.byteLength > limits.maxFileBytes) throw new EaFileError('LIMIT_EXCEEDED', 'File exceeds maxFileBytes.');
  const sections = findCareerSections(bytes);
  const competitionSection = sectionBounds(sections, 'compavg');
  const standingSection = sectionBounds(sections, 'stagadv');
  if (competitionSection === undefined || standingSection === undefined) {
    throw new EaFileError('INVALID_FORMAT', 'Career competition and standings sections were not found.');
  }
  const competitions = parseCompetitions(bytes, competitionSection.start, competitionSection.end);
  const standings = parseStandings(bytes, standingSection.start, standingSection.end);
  const fixtureSection = sectionBounds(sections, 'teams');
  const fixtures = fixtureSection === undefined ? [] :
    parseFixtures(bytes, fixtureSection.start, fixtureSection.end, standings, new Set(competitions.map((node) => node.id)));
  const statsBlock = blockAfter(sections, 'stndgs');
  const playerStats = statsBlock === undefined ? [] : parsePlayerStats(bytes, statsBlock.start, statsBlock.end);
  const settingsBlock = blockAfter(sections, 'script');
  const settings = settingsBlock === undefined ? [] : parseCompetitionSettings(bytes, settingsBlock.start, settingsBlock.end);
  const tasksBlock = blockAfter(sections, 'sched');
  const tasks = tasksBlock === undefined ? [] : parseCompetitionTasks(bytes, tasksBlock.start, tasksBlock.end);
  const records = competitions.length + standings.length + fixtures.length + playerStats.length + settings.length + tasks.length;
  if (records > limits.maxTotalRecords) {
    throw new EaFileError('LIMIT_EXCEEDED', 'Decoded record or value limit exceeded.');
  }
  return {
    formatVersion: 1,
    source: { fileName: options.fileName ?? null, byteLength: bytes.byteLength },
    sections,
    competitions,
    standings,
    fixtures,
    playerStats,
    settings,
    tasks,
  };
}
