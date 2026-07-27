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

## Parallel collaboration

These rules apply whenever more than one developer or agent may work on the repository.

### Claim work before editing

1. Create or claim a GitHub issue for every task before changing files.
2. Record the task owner, branch name, intended outcome, and the main files or areas expected to change.
3. One person owns a task and its branch at a time. Never have two people push to the same branch.
4. Before starting, check active issues and open pull requests for overlapping work.
5. If two tasks need the same file or interface, agree on ownership and merge order before editing. Split the work by a stable boundary when possible.

### Branch and synchronization rules

- Never develop directly on `main`.
- Humans should use `feature/<developer>/<short-task-name>`, `fix/<developer>/<short-task-name>`, or `chore/<developer>/<short-task-name>` branches. Codex uses `codex/<short-task-name>`.
- Before the first commit on a machine, configure `user.name` and a GitHub-verified or GitHub-provided noreply email. Never commit with an auto-generated `.local` address.
- Start every branch from the latest `origin/main`.
- Fetch `origin` before each work session and before opening or updating a pull request.
- Before requesting final review, incorporate the latest `origin/main` into the feature branch and run all required checks again.
- Rebase only a branch that nobody else uses. Never rewrite shared branch history.
- Do not mix unrelated fixes, formatting, generated files, or cleanup into a feature branch.

### High-conflict files and interfaces

- Coordinate before changing shared configuration, `package.json`, `package-lock.json`, `.env.example`, `lib/db.ts`, `db/schema.sql`, authentication code, or public API and component interfaces.
- Assign migration numbers before creating migration files so two branches never introduce the same number.
- Never edit or renumber a migration that has already been merged. Add a new numbered migration instead.
- When changing an interface used by another active task, agree on the interface first and merge that small contract change before dependent work when practical.
- Avoid repository-wide formatting while another feature branch is active.

### Pull requests and merge order

1. Open a draft pull request early so the team can see the scope and affected files.
2. Keep each pull request focused and small enough to review independently.
3. Describe behavior changes, affected areas, migrations, configuration steps, and validation results in the pull request.
4. Request review from the other developer and do not merge your own pull request without that review, except for an explicitly agreed emergency.
5. Merge overlapping pull requests one at a time. After the first merge, update and revalidate the remaining branch before merging it.
6. Do not merge with unresolved review comments, failing checks, uncertain conflicts, or undocumented manual steps.
7. Delete a feature branch only after its pull request is merged and no follow-up work depends on it.

### Conflict and handoff rules

- Stop and coordinate when a merge conflict affects behavior you do not own or understand. Do not guess which version is correct.
- Never discard another contributor's changes to make a conflict disappear.
- When handing work to another person, leave the branch pushed and document the current state, remaining work, validation status, and known risks in the issue or pull request.
- If work must pause, make a small checkpoint commit only when it is coherent and safe; otherwise document the uncommitted state without sharing secrets.
- Inform the other developer immediately about breaking changes, reverted work, migration changes, or required environment updates.

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
