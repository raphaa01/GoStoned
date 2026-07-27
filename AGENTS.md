# GoStoned team rules

- Keep `main` stable and deployable.
- Use one focused branch per feature or setup change.
- Prefer small, descriptive commits.
- Never commit `.env`, credentials, tokens, passwords, or other secrets.
- Route every PostgreSQL connection through `lib/db.ts`.
- Read database credentials only from `DATABASE_URL`.
- Make database changes only through `db/schema.sql` and new numbered files in `db/migrations/`.
- Run at least `npm run typecheck` and `npm run build` before opening a pull request.
- Add no unnecessary libraries.
- Do not perform large refactors without an explicit request.
