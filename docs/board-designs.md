# Board designs

The profile's board-design picker and `BoardDesignProvider` are shared by the
website and the bundled Capacitor Android/iOS client. `GoBoard` receives only a
cosmetic data attribute; its grid geometry, move handlers, bot worker and scoring
rules remain shared and unchanged.

Default and light oak are available immediately. Dark slate, white porcelain,
sage and Bordeaux unlock at 10, 20, 30 and 50 completed wins respectively. All
board sizes and game modes count, including friendly and bot games. Draws,
no-results and active games do not count. The server checks the authenticated
account's complete win history in the same SQL statement that saves a selection.
The other five designs have full previews and stay unavailable as “Coming soon”.

Generated artwork in `public/images/board-designs/` is preview artwork only.
Playable boards use CSS materials with the actual game grid and actual stones,
so preview stones never become part of the playing surface.

Apply `db/migrations/047_board_designs.sql` before deploying the new server.
The production schema preflight verifies the preference column and constraint.
When applying through management tooling, record `047_board_designs.sql` in the
existing `public.schema_migrations` ledger as well.

Validation:

- `npm run typecheck`, `npm test`, `npm run build`, `npm run mobile:typecheck`
- `npm run mobile:build`
- `npx playwright test tests/browser/board-designs.spec.ts`
- `npx playwright test --config playwright.mobile-board-designs.config.ts`
- `npx tsx scripts/smoke-board-designs.ts` against the explicitly configured local
  smoke database; CI runs this after migrating its isolated PostgreSQL instance.

`mobile:sync` copies the bundle and previews into both native projects. Native
store releases still require the existing Android/iOS signing and release process.
