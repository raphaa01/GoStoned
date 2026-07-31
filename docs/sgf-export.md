# SGF export contract

GoStone exports one deterministic SGF FF[4] game from an explicit persisted
evidence contract in `lib/game/sgfExport.ts`. Export does not consult the
current matchmaking default, rescore a position, or infer a terminal reason
from display text.

## Rules and moves

- `FF[4]`, `GM[1]`, `CA[UTF-8]`, and the exact persisted `SZ` are always
  written.
- `RU` is the exact versioned GoStone rules profile. Japanese games therefore
  use `RU[japanese-1989-gostone-v1]`; historical Chinese games retain either
  `RU[chinese-2002-gostone-v1]` or `RU[legacy-immediate-area]`.
- `KM` is the persisted komi and is validated against that profile. Export
  never substitutes the current creation default.
- Even games omit both `HA` and `AB`. A handicap game writes them only when a
  complete, unique, in-bounds setup accompanies
  `gostone-fixed-handicap-v1` verified-placement evidence. The first played
  move must then be White.
- Played moves use `B` and `W` nodes in dense persisted order. FF[4] passes are
  empty property values (`B[]` or `W[]`), never the historical `tt` convention.
- Board sizes 9, 13, and 19 use the ordinary lower-case SGF coordinates from
  `aa` through `ii`, `mm`, or `ss` respectively.

The result input is discriminated rather than a free-form result string.
Scores become `B+<margin>` or `W+<margin>`, resignation becomes `B+R` or
`W+R`, timeout becomes `B+T` or `W+T`, scoring abandonment becomes `B+F` or
`W+F`, draw becomes `0`, and no-result becomes `Void`. No-result is not
collapsed into a draw.

## Language-neutral machine metadata

The custom properties below are stable identifiers for software. Their names,
enumerated values, and JSON keys must not be translated for English, German,
or another locale.

| Property | Machine value |
| --- | --- |
| `GSCV` | `gostone-sgf-export-v1` contract version |
| `GSID` | Persisted game UUID |
| `GSRP` | Exact persisted versioned rules profile |
| `GSRS` | Persisted `japanese` or `chinese` ruleset identifier |
| `GSSM` | Persisted `territory` or `area` scoring identifier |
| `GSNR` | Stable no-result reason; present only when `RE[Void]` |
| `GSBOTB` | Canonical JSON bot disclosure for Black, when supplied |
| `GSBOTW` | Canonical JSON bot disclosure for White, when supplied |

Bot JSON has the ordered shape
`{"kind":"bot","provider":"...","model":"...","version":"..."}`;
`version` is omitted when unavailable. It is disclosure metadata only and does
not affect rules or result authority.

## Safety and integration

All free text is length-bounded, NUL is rejected, line endings are normalized,
and SGF backslashes and closing brackets are escaped. The serializer rejects
unknown contract fields, mismatched rules tuples, incomplete handicap evidence,
non-dense moves, an invalid initial player, malformed passes, and non-canonical
result objects. Later move colors are preserved as stored: verified scoring
resumption can legitimately make one color appear in consecutive SGF nodes.

The participant-only `GET /api/games/:gameId/sgf` route builds its input from
one repeatable-read snapshot of persisted game, move, and Japanese terminal
evidence. It exports finished games only and must not synthesize no-result from
a null winner or localized copy.
