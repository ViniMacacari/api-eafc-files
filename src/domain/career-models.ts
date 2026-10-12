import type { ReadLimits } from './models.js';

export type CompetitionLevel = 'confederation' | 'nation' | 'competition' | 'stage' | 'group' | 'unknown';

export interface CareerSection {
  readonly name: string;
  readonly offset: number;
  readonly byteLength: number;
}

export interface CompetitionNode {
  readonly id: number;
  readonly parentId: number | null;
  readonly level: CompetitionLevel;
  readonly levelCode: number;
  readonly code: string;
  readonly nameKey: string;
}

export interface StandingSplit {
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
}

export interface StandingEntry {
  readonly index: number;
  readonly groupId: number;
  readonly teamId: number | null;
  readonly slot: number;
  readonly home: StandingSplit;
  readonly away: StandingSplit;
  readonly points: number;
}

export interface FixtureSide {
  readonly standingIndex: number;
  readonly teamId: number | null;
  readonly goals: number | null;
  readonly penalties: number | null;
}

export interface Fixture {
  readonly index: number;
  readonly competitionId: number;
  readonly groupId: number;
  readonly round: number;
  readonly date: number;
  readonly time: number;
  readonly played: boolean;
  readonly home: FixtureSide;
  readonly away: FixtureSide;
}

export interface CareerData {
  readonly formatVersion: 1;
  readonly source: { readonly fileName: string | null; readonly byteLength: number };
  readonly sections: readonly CareerSection[];
  readonly competitions: readonly CompetitionNode[];
  readonly standings: readonly StandingEntry[];
  readonly fixtures: readonly Fixture[];
}

export interface CareerParseOptions {
  readonly fileName?: string;
  readonly limits?: Partial<ReadLimits>;
}
