# Puzzle catalogs

The active catalog is `imported/gostone-puzzles.json`, the complete original
0.1 export supplied on 2026-10-07. Its MIT source notice is preserved alongside
it. `exportSummary` records 65 requested, 61 exported and four missing IDs;
the missing puzzle positions and solutions are not present in the supplied ZIP.

`importedCatalog.ts` validates the supplied playback endpoints and includes
the additional proven alternatives from the node tree. Unknown choices are
never classified as wrong. Corner reflections preserve the full 19×19 rule
board while fitting the existing board viewport. Answers are imported only by
server modules, never shipped in the mobile/web client or unsolved hub views.

The previous `curatedCatalog.ts`, `gokyoShumyoCatalog.json`, `gokyoShumyo.ts`,
`dailyCatalog.ts`, `staticDailyPuzzle.ts`, `puzzleService.ts` and generation
worker remain here as an archive, with their original source information and
tests. Public puzzle routes use `importedService.ts` exclusively. Existing
database puzzle rows and attempts are preserved; only the imported UUIDs are
listed publicly. No historical rows or progress are deleted.
