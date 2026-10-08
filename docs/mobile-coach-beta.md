# Mobile Coach Beta

The iOS/Android app exposes **Play → Play against Coach · Beta** only when the
current authenticated session has `coachBetaEnabled: true`. Web browsers do
not expose the entry or the direct mobile route. Migration
`053_mobile_coach_beta.sql` adds `users.coach_beta_enabled`, default false, and
invites the explicitly requested account `rapha`. Session lookup reads the
database flag through `lib/db.ts`; older databases fail closed. Logging out,
switching accounts, or a refreshed revoked entitlement unmounts the game and
cancels native analysis and the language worker. These are local practice
games, with no ranking changes or server bot calls.

## Bundle and inference

`assets/coach/` contains the user-supplied v5 epoch-840 ONNX model, manifest,
schema, tokenizer and original integration notes. `COACH_MODEL` pins hashes;
the mobile asset builder and worker both verify the four runtime files. The
runtime bundle adds approximately **7.6 MB**. `weights.pt` is deliberately
omitted: it duplicates the ONNX weights and is only needed for Python training.
The existing ONNX Runtime 1.27 WASM runtime is reused; no language teacher or
external model service is required. Model assets are outside `public/` and are
copied only into `.mobile-assets` for mobile builds.

The coach worker loads once on entry. Native KataGo is also warmed with a
two-visit position request while board size is being selected. The human plays
Black, with Japanese normal-play legality and 6.5 komi. Only the human's move
invokes the commentator. The opponent's move leaves the human comment intact.

1. Before-position analysis is prefetched while the human thinks: 12 visits,
   0.65 seconds search limit. A cache miss retries that single position.
2. After the human move: another 12-visit / 0.65-second scan, without ownership
   overhead. Point loss is calculated in Black's perspective against the
   searched legal best alternative from the before-position analysis.
3. `coachEvidence.ts` verifies captures, connections, liberty gains, saved
   atari groups, newly created enemy ataris and legally capturable own ataris.
   It provides the **63 normalized context features** and **11×19×19 board
   planes**, top-left padded, including the legal simulated alternative.
4. The learned reason head selects among grounded reasons with an applicable
   phrase. Actual autoregressive language logits drive beam search (width 4)
   through a prefix trie of applicable approved sentences. Maximum 30 words,
   190 characters, 384 tokens, and 1.8 seconds decoding work. Word tokens begin
   at 259; punctuation, whitespace and unknown words use UTF-8 byte+3 tokens.
5. Every phrase must pass its quality, facts, numbers, alternative numbers,
   zones and board-size rules. Unknown rules/facts fail closed. Context-bound
   human/teacher corrections and `human_insight` are excluded from ordinary
   games. There are extra guards for missing numeric annotations in the pilot
   bank. No valid completed sentence means **no model comment**; UI status text
   is separate, rather than an invented trainer explanation.
6. Large losses and candidate exceptional moves get a second 32-visit,
   1.2-second search of both positions. Only consistent confident losses of
   at least 8 points offer **Try again / Continue** before the opponent replies.
   The displayed grade is uncertain below the quick scan's visit thresholds;
   otherwise losses of 1/3/8 points are inaccuracy/mistake/blunder. A confirmed
   best move with a searched runner-up at least 2 points worse can receive the
   strong-move tone. Physical benefits do not imply overall praise.
7. The opponent has a separate search capped at 7 seconds and 16–80 visits.
   Its choice among searched legal candidates depends on the player's current
   rating, temperature and allowed point loss. This is **approximate strength
   matching, not calibrated Elo**. It never invents an early pass to weaken
   itself. The ordinary browser bot and its artifact identity are unchanged.

The native `analyzePosition` method requests only the last turn, keeps the
KataGo engine warm, suppresses review progress events, respects thermal limits
and supports cancellation. Calls are serialized including completion of
cancelled work. Unique request IDs plus UI revisions prevent stale hints,
comments and replies after undo/resignation or account changes. Search limits
are bounded on both native platforms. They exclude cold model initialization,
and cannot guarantee an exact total time on all phone CPUs.

## Board tools and estimation

**Hint** marks KataGo's searched legal best move. **Show** marks the grounded
comment's affected stones/intersections and the before-position alternative;
it doesn't stop play or automatically cover the board. Captured intersections
can be marked even after their stones disappear. **Undo / Try again** replays
the game before the last human move, removing its reply and restoring captures,
prisoners, passes and ko. Pass and resign are available normally.

The expandable estimate searches the current position with 24 visits / 1.2
seconds and explicitly requests ownership. Both lead and ownership respect
the native config's `SIDETOMOVE` perspective before converting to Black/White.
See the [KataGo 1.18.2 analysis contract](https://github.com/lightvector/KataGo/blob/v1.18.2/docs/Analysis_Engine.md)
and [ownership implementation](https://github.com/lightvector/KataGo/blob/v1.18.2/cpp/search/searchresults.cpp).
The bar reports estimated point lead; the board shades ownership above 0.55
confidence. This is **an estimate, not final Japanese scoring**. After two
passes this local practice game ends without claiming an agreed final score.

## Validation and beta limits

Run `npm run typecheck`, `npm run mobile:typecheck`, `npm test`, `npm run build`,
`npm run mobile:build`, then:

```sh
npx playwright test --config playwright.mobile-board-designs.config.ts tests/mobile/coach.spec.ts
npm run mobile:android:build
```

The browser flow tests use the **real ONNX/WASM model**, with a simulated native
KataGo bridge and account API. They cover account visibility, direct-route
gating, comments only for human moves, hints, ownership, whole-turn undo,
confirmed blunder retries, entitlement revocation and taps during the opponent
turn without a sticky hover stone in either mobile platform. Desktop web hover,
keyboard focus and the deliberate touch lens remain available. Unit tests verify bundle
hashes, board masks, tactical evidence, forbidden ungrounded phrases, legal
opponent selection, cancelled native work and score/ownership perspective.

The supplied manifest has `releaseReady: false` and `humanQualityVerified:
false`: the sentence bank remains a German-only pilot. Unsupported strategic
claims (ladders, forced long variations, sacrifice, life/death, plans) are not
guessed. Do not interpret automatic rule filtering as expert human validation.
Before wider rollout, measure comment/reply latency, heating, undo during
search and language quality on **physical Android and iOS devices**. Windows
can build Android; the Swift platform integration still needs a Mac/Xcode
build and device run (`npm run mobile:ios:release`).
