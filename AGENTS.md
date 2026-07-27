# GoStone team rules

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

## Automatic Git workflow

These rules apply to every task that changes repository files.

### Before making changes

1. Run `git status`.
2. If unrelated or uncommitted changes exist, do not overwrite, reset, or stash them. Explain the situation to the user before continuing.
3. Run `git fetch origin`.
4. Switch to `main`.
5. Update it with `git pull --ff-only`.
6. Create a focused branch named `codex/<short-task-name>`.
7. Never modify files directly on `main`.

Pure questions, explanations, reviews, and other read-only tasks do not require a new branch.

### After making changes

1. Review the complete diff.
2. Run:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
3. Fix failures caused by the current task.
4. Stage only files that belong to the current task.
5. Never stage or commit `.env`, credentials, passwords, tokens, or other secrets.
6. Create a clear, descriptive commit.
7. Push the branch with `git push -u origin <branch-name>`.
8. Create a draft pull request against `main` when GitHub access is available.
9. Never merge the pull request automatically.
10. Report the branch, commit, validation results, pull-request link, and any remaining problems.

### Git safety

- Never run `git reset --hard`.
- Never delete unrelated user changes.
- Never overwrite another contributor's branch.
- Never force-push.
- Stop and explain merge conflicts instead of resolving uncertain conflicts automatically.
- If GitHub authentication is unavailable, complete safe local work and explain exactly what the user must do.
