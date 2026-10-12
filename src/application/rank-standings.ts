import type { StandingEntry } from '../domain/career-models.js';

export interface RankedStanding extends StandingEntry {
  readonly position: number;
  readonly played: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalDifference: number;
}

export function rankStandings(standings: readonly StandingEntry[], groupId: number): RankedStanding[] {
  return standings
    .filter((entry) => entry.groupId === groupId && entry.teamId !== null)
    .map((entry) => {
      const wins = entry.home.wins + entry.away.wins;
      const draws = entry.home.draws + entry.away.draws;
      const losses = entry.home.losses + entry.away.losses;
      const goalsFor = entry.home.goalsFor + entry.away.goalsFor;
      const goalsAgainst = entry.home.goalsAgainst + entry.away.goalsAgainst;
      return { ...entry, position: 0, played: wins + draws + losses, wins, draws, losses, goalsFor, goalsAgainst,
        goalDifference: goalsFor - goalsAgainst };
    })
    .sort((a, b) => b.points - a.points || b.wins - a.wins || b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor || a.slot - b.slot)
    .map((entry, index) => ({ ...entry, position: index + 1 }));
}
