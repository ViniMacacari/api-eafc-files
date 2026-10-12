import type { CareerData, CareerParseOptions } from '../domain/career-models.js';
import { EaFileError } from '../domain/errors.js';
import { resolveLimits } from '../domain/limits.js';
import { findCareerSections, sectionBounds } from '../infrastructure/career/career-sections.js';
import { parseCompetitions } from '../infrastructure/career/competition-parser.js';
import { parseFixtures } from '../infrastructure/career/fixture-parser.js';
import { parseStandings } from '../infrastructure/career/standings-parser.js';

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
  if (competitions.length + standings.length + fixtures.length > limits.maxTotalRecords) {
    throw new EaFileError('LIMIT_EXCEEDED', 'Decoded record or value limit exceeded.');
  }
  return {
    formatVersion: 1,
    source: { fileName: options.fileName ?? null, byteLength: bytes.byteLength },
    sections,
    competitions,
    standings,
    fixtures,
  };
}
