import type { CareerData, StandingZone, StandingZoneType } from '../domain/career-models.js';

const positionKeys: ReadonlyMap<number, StandingZoneType> = new Map([
  [39, 'champion'],
  [40, 'promotion'],
  [41, 'promotionPlayoff'],
  [42, 'relegation'],
  [43, 'relegationPlayoff'],
]);
const continentalColorKeys = [60, 61, 62, 63, 64, 65];
const leagueKey = 117;
const promotionLeagueKey = 37;
const relegationLeagueKey = 38;
const fillFromLeagueAction = 7;

function sorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function continentalZones(career: CareerData, leagueId: number, groupSize: number): StandingZone[] {
  const zones: { competitionId: number; targetGroupId: number; positions: number[] }[] = [];
  let next = 1;
  for (const task of career.tasks) {
    if (task.action !== fillFromLeagueAction || task.source !== leagueId || task.first <= 0) continue;
    const positions = Array.from({ length: task.first }, (_, i) => next + i).filter((position) => position <= groupSize);
    next += task.first;
    const zone = zones.find((candidate) => candidate.competitionId === task.competitionId && candidate.targetGroupId === task.target);
    if (zone) zone.positions.push(...positions);
    else zones.push({ competitionId: task.competitionId, targetGroupId: task.target, positions });
  }
  const entries = new Map<number, number>();
  return zones
    .filter((zone) => zone.positions.length > 0)
    .map((zone) => {
      const entry = (entries.get(zone.competitionId) ?? 0) + 1;
      entries.set(zone.competitionId, entry);
      return {
        type: 'continental' as const,
        positions: sorted(zone.positions),
        competitionId: zone.competitionId,
        targetGroupId: zone.targetGroupId,
        entry,
        leagueId: null,
      };
    });
}

export function standingZones(career: CareerData, groupId: number): StandingZone[] {
  const nodes = new Map(career.competitions.map((node) => [node.id, node]));
  const stage = nodes.get(nodes.get(groupId)?.parentId ?? -1);
  const competition = nodes.get(stage?.parentId ?? -1);
  if (competition === undefined || competition.level !== 'competition') return [];
  const groupSettings = career.settings.filter((setting) => setting.competitionId === groupId);
  const competitionSetting = (key: number): number | null =>
    career.settings.find((setting) => setting.competitionId === competition.id && setting.key === key)?.value ?? null;
  const groupSize = career.standings.filter((entry) => entry.groupId === groupId && entry.teamId !== null).length;
  const zones: StandingZone[] = [];
  for (const [key, type] of positionKeys) {
    const positions = sorted(groupSettings.filter((setting) => setting.key === key).map((setting) => setting.value));
    if (positions.length === 0) continue;
    zones.push({
      type,
      positions,
      competitionId: null,
      targetGroupId: null,
      entry: null,
      leagueId: type.startsWith('promotion')
        ? competitionSetting(promotionLeagueKey)
        : type.startsWith('relegation') ? competitionSetting(relegationLeagueKey) : null,
    });
  }
  const colored = continentalColorKeys
    .map((key) => sorted(groupSettings.filter((setting) => setting.key === key).map((setting) => setting.value)))
    .filter((positions) => positions.length > 0);
  if (colored.length === 0) return zones;
  const leagueId = competitionSetting(leagueKey);
  const continental = leagueId === null ? [] : continentalZones(career, leagueId, groupSize);
  const championPositions = zones.find((zone) => zone.type === 'champion')?.positions ?? [];
  return [
    ...zones,
    ...colored.map((positions) => {
      const covering = continental.filter((zone) => zone.positions.some((position) => positions.includes(position)));
      const competitionIds = new Set(covering.map((zone) => zone.competitionId));
      const covered = positions.every((position) => covering.some((zone) => zone.positions.includes(position)));
      const first = covering[0];
      if (competitionIds.size !== 1 || !covered || first === undefined) {
        return { type: 'continental' as const, positions, competitionId: null, targetGroupId: null, entry: null, leagueId: null };
      }
      const champion = championPositions.filter((position) => covering.some((zone) => zone.positions.includes(position)));
      return { ...first, positions: sorted([...champion, ...positions]), entry: Math.min(...covering.map((zone) => zone.entry ?? 1)) };
    }),
  ];
}
