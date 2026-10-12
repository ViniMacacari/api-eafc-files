# Career data outside the databases

A career save stores more than its two DB databases. After the last database, the game writes named binary sections with competition structure, the live standings and the season schedule. `leagueteamlinks` does not hold the live table: its points stay at 0 and `currenttableposition` is not updated. The real data lives in these sections.

`readCareerData` and `parseCareerData` decode them. Both are read-only and independent from `readEaFile`, so a caller can read databases and career data from the same file without decoding it twice.

```ts
import { readCareerData, readEaFile, rankStandings } from 'api-eafc-files';

const path = 'C:/saves/CmMgrC20261011025536442';
const career = await readCareerData(path);
const save = await readEaFile(path, { version: 'FC 26', tables: ['career_users', 'teams'] });

const user = save.databases.flatMap(db => db.tables).find(table => table.name === 'career_users')?.records[0];
const stages = career.competitions.filter(node => node.parentId === user?.primarycompobjid).map(node => node.id);
const group = career.competitions.find(node => stages.includes(node.parentId ?? -1)
  && career.standings.some(entry => entry.groupId === node.id && entry.teamId === user?.clubteamid));

const table = rankStandings(career.standings, group!.id);
```

| Function | Return value | Purpose |
| --- | --- | --- |
| `readCareerData(path, options?)` | `Promise<CareerData>` | Read a career save from disk |
| `parseCareerData(bytes, options?)` | `CareerData` | Decode bytes without I/O |
| `rankStandings(standings, groupId)` | `RankedStanding[]` | Totals and positions for one group |

Options accept `fileName` and `limits`. `maxFileBytes` and `maxTotalRecords` apply. Squad files have no career sections and produce `INVALID_FORMAT`.

## Result

```json
{
  "formatVersion": 1,
  "source": { "fileName": "CmMgrC20261011025536442", "byteLength": 18616153 },
  "sections": [{ "name": "compavg", "offset": 12913858, "byteLength": 122512 }],
  "competitions": [{ "id": 1528, "parentId": 1425, "level": "competition", "levelCode": 3, "code": "C80", "nameKey": "TrophyName_Abbr15_80" }],
  "standings": [{ "index": 4698, "groupId": 1530, "teamId": 598, "slot": 13,
    "home": { "wins": 9, "draws": 2, "losses": 1, "goalsFor": 41, "goalsAgainst": 14 },
    "away": { "wins": 6, "draws": 2, "losses": 3, "goalsFor": 28, "goalsAgainst": 18 }, "points": 49 }],
  "fixtures": [{ "index": 1813, "competitionId": 1528, "groupId": 1530, "round": 24, "date": 20280820, "time": 1930, "played": false,
    "home": { "standingIndex": 4696, "teamId": 1048, "goals": null, "penalties": null },
    "away": { "standingIndex": 4698, "teamId": 598, "goals": null, "penalties": null } }]
}
```

Values are illustrative.

### Competitions

The tree has five levels: `confederation` → `nation` → `competition` → `stage` → `group`.

- `career_users.primarycompobjid`, `career_competitionprogress.compobjid` and `fixtures[].competitionId` are `competition` ids.
- `code` is `C<id>` for competitions and equals `career_competitionprogress.compshortname`. When the id matches a `leagues.leagueid`, use the save's `leaguename`: squad mods rename leagues while the key still points to the original name.
- `nameKey` is a localization key (`TrophyName_Abbr15_80`, `FCE_League_Stage`, `NationName_14`) that can be looked up in `readTemplateDatabase({ version, database: 'localization' })`.

### Standings

One entry per team slot of every group, including empty slots of stages not drawn yet (`teamId: null`). `slot` is the order inside the group, not the position. The save does not store positions: `rankStandings` sorts by points, wins, goal difference and goals scored. Competition-specific tie-breakers are not applied. In knockout ties `points` may not equal `3 × wins + draws`.

### Fixtures

Each fixture references both sides through `standingIndex`, which is how teams are resolved (`teamId`) and how `groupId` is set. `round` is the matchday inside the stage. `date` is `yyyyMMdd` and `time` is `HHmm`. `goals` and `penalties` are `null` for matches not yet played or without a shootout.

## Binary layout

Sections start with a little-endian UInt32 name length, the lowercase ASCII name and `0x01`. Records start with `FF 01`. All integers are little endian.

| Section | Record | Layout |
| --- | ---: | --- |
| `compavg` | 49 bytes | `FF 01`, UInt16 id, UInt16 id, UInt8 level, UInt16 parent, 7-byte code, 33-byte name key |
| `teams` | 22 bytes | `FF 01`, UInt16 index, UInt16 competition, UInt8 round, UInt32 date, UInt16 time, UInt16 home slot, UInt8 home goals, UInt8 home penalties, UInt16 away slot, UInt8 away goals, UInt8 away penalties, UInt8 played |
| `stagadv` | 23 bytes | `FF 01`, UInt16 index (1-based, sequential), UInt16 group, Int32 team, UInt8 slot, five UInt8 home values, five UInt8 away values (W, D, L, GF, GA), UInt8 points, UInt8 reserved |

`0xFF` marks a missing score or shootout. Other sections (`stndgs`, `sched`, `fixture`, `script`, `stats`, `objctvs`, `deepsim`, ...) are listed in `sections` but not decoded.

## Evidence

The layout was reverse-engineered from FC 26 saves and is not documented by EA. It was checked against two independent careers (a 20-team league and a 96-team league split in 16 groups) and a backup slot: every fixture referenced a known standing slot, and each club's fixtures summed exactly to its standing totals. A game update may change these sections.
