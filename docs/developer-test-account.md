# Developer test access

The explicitly requested `developer` account has been provisioned through the
normal registration flow. Its password is hashed by the existing password
service; no password, session token, or deployment credential is in this change.

`lib/auth/developerAccess.ts` binds the following limited entitlements to its
immutable account UUID, not to a user-editable name or a client-supplied role:

- No weekly limit for game analyses. Game ownership, authenticated requests,
  completed-game checks, and existing analysis job deduplication still apply.
- The existing native AI coach beta on Android and iOS. This does not introduce
  a paid server bot or change normal browser bot moves.
- Access to every actual learning lesson, including later checkpoints, without
  marking lessons or stages complete. Attempts and ordinary completion rules
  remain unchanged, including the real-win requirement of stage 5.
- A small `DEV` tag beside the player's name in games and results, derived by
  the server from the account joined to the game.

This is not an administrator role: it grants no access to other players' private
games, analyses, messages, accounts, moderation, or database operations. Existing
premium analysis and coach-invite flags continue to work independently.

Remove the UUID from the allowlist to revoke these test entitlements. The next
authenticated session request closes test navigation; each analysis request
checks the allowlist again. Deleting the account also removes its sessions via
the existing account deletion flow. Never grant access by username.

No database schema change is required. Website and the bundled mobile clients
consume the same server-authenticated entitlements and shared lesson/game UI.

Verification covers identity/name spoofing, existing premium/invite flags,
authenticated sessions, actual analysis queue quota decisions, and server-derived
game tags. Shared mobile browser tests cover every lesson's unlocked navigation,
role revocation, logout, and light/dark nametag layouts. The PostgreSQL CI smoke
creates an ephemeral local fixture with the allowlisted identity and a random
test password, signs in through the real API, opens the last lesson through the
server account gate, verifies empty completion lists, logs out, and deletes only
that fixture. It refuses non-local databases and requires an explicit matching
smoke database/role identity before writing.
