# Career data outside the databases

A career save stores more than its two DB databases. After the last database, the game writes named binary sections with competition structure, the live standings, the season schedule and player statistics. `leagueteamlinks` does not hold the live table: its points stay at 0 and `currenttableposition` is not updated. `teamplayerlinks` does not hold season statistics either: `leagueappearances` stays at 0 during a career. The real data lives in these sections.

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
    "away": { "standingIndex": 4698, "teamId": 598, "goals": null, "penalties": null } }],
  "playerStats": [{ "index": 15727, "playerId": 240332, "teamId": 598, "competitionId": 1528,
    "appearances": 15, "minutes": 819, "goals": 13, "assists": 7, "yellowCards": 1, "redCards": 0, "manOfTheMatch": 4,
    "cleanSheets": 2, "goalsConceded": 15, "saves": 0, "ratingTotal": 1112, "averageRating": 7.41,
    "recentMatches": [{ "date": 20280625, "played": true, "minutes": 59, "rating": 10, "goals": 4, "position": 25 }] }]
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

### Player statistics

One entry per player, team and competition for the current season, for every team in the world, not only the user's club. Statistics follow the team the player had when they were recorded: when a player is sold, the game removes the entries of the old club.

- `appearances`, `minutes`, `goals`, `assists`, `yellowCards`, `redCards` and `manOfTheMatch` are totals for that competition.
- `cleanSheets` and `goalsConceded` count matches and goals while the player was on the pitch; for goalkeepers they match the team totals.
- `saves` is only filled for goalkeepers. The game counts saves in full only in matches the user plays; matches simulated between CPU teams add very few, so CPU goalkeepers show low totals.
- `ratingTotal` is the sum of match ratings in tenths; `averageRating` is `ratingTotal / appearances / 10`, rounded to two decimals, or `null` without appearances.
- `recentMatches` holds up to the last five matches of the team in that competition, oldest first. `played` is `false` when the player was not used. `rating` is `null` in that case. `position` uses the 0–29 position ids of `players.preferredposition1`.
- Player goals include extra time, while fixture scores do not. In knockout matches decided after 90 minutes, the sum of player goals can exceed the fixture score. In league competitions they match.

## Binary layout

Each block is followed by a tag with a little-endian UInt32 name length and the lowercase ASCII name. The tag names the block before it, so the competition tree ends at `compobj`, the fixtures at `fixture`, the standings at `stndgs` and the player statistics at `stats`. All integers are little endian.

| Block | Between tags | Record | Layout |
| --- | --- | ---: | --- |
| Competition tree | `compavg` … `compobj` | 49 bytes | `FF 01`, UInt16 id, UInt16 id, UInt8 level, UInt16 parent, 7-byte code, 33-byte name key |
| Fixtures | `teams` … `fixture` | 22 bytes | `FF 01`, UInt16 index, UInt16 competition, UInt8 round, UInt32 date, UInt16 time, UInt16 home slot, UInt8 home goals, UInt8 home penalties, UInt16 away slot, UInt8 away goals, UInt8 away penalties, UInt8 played |
| Standings | `stagadv` … `stndgs` | 23 bytes | `FF 01`, UInt16 index (1-based, sequential), UInt16 group, Int32 team, UInt8 slot, five UInt8 home values, five UInt8 away values (W, D, L, GF, GA), UInt8 points, UInt8 reserved |
| Player statistics | `stndgs` … `stats` | 73 bytes | `01 01`, then bit fields described below; 24,000 slots, empty slots have a zero key |

`0xFF` marks a missing score or shootout.

Player statistics records are bit packed, least significant bit first, the same order used by DB integers. Bit offsets are from the start of the record:

| Bits | Field |
| ---: | --- |
| 16–33 | team id + 1 |
| 34–52 | player id + 1 |
| 53–63 | competition id |
| 69–83 | minutes |
| 84–95 | sum of ratings in tenths |
| 108–116 | goals |
| 117–123 | yellow cards |
| 124–129 | red cards |
| 130–137 | appearances |
| 138–145 | assists |
| 146–153 | man of the match |
| 154–161 | saves |
| 162–169 | goals conceded on the pitch |
| 170–175 | clean sheets on the pitch |

Bytes 22–71 hold five 10-byte match entries. Inside an entry: bits 3–27 date (`yyyyMMdd`, `0` for an empty slot), 35–41 minutes (capped at 90), 42–48 rating in tenths, 50–52 goals and 64–69 position + 1. Bits outside these ranges are not interpreted.

Other blocks (`sched`, `script`, `objctvs`, `deepsim`, ...) are listed in `sections` but not decoded.

## Evidence

The layout was reverse-engineered from FC 26 saves and is not documented by EA. It was checked against two independent careers (a 20-team league and a 96-team league split in 16 groups) and a backup slot: every fixture referenced a known standing slot, and each club's fixtures summed exactly to its standing totals.

Player statistics were checked the same way. In 7,327 records whose five match entries cover the whole competition, appearances, minutes, goals and rating sums equal the sum of the entries. Across a 20-team league, player goals equal team goals for 17 teams, and goalkeepers' goals conceded and clean sheets equal the team figures for 18. Between two saves of the same career, every changed record belonged to a player of a team that played in between. Per-match values matched an external match export for 25 players.

A game update may change these sections.
