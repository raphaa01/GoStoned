# GoStone Local Training Lab

The Training Lab is an offline, resumable KataGo-to-student system. Teacher
weights, data shards, checkpoints, and generated models stay below
`.cache/gostone-bot-training/` and are not part of the production bundle.

## Start with one double-click

1. Start Docker Desktop and wait until it reports that the engine is ready.
2. Double-click `Start-GoStone-Training.cmd` in the repository root.
3. The control center opens at `http://127.0.0.1:4173`.
4. Leave **Week-long Deep Training** selected, choose the CPU limit, and press
   **Start training**.

The first real run is always **GoStone AI v5**. V5 uses random initial weights
and never loads a V1–V4 checkpoint or replay shard. A later real run becomes V6,
V7, and so on; it loads the newest V5-family checkpoint and streams every
available V5-family training shard as replay data. Model version V6 deliberately
keeps architecture version 5 so every V5 weight can be inherited exactly.

The System Check preset is only a technical smoke test. It does not consume a
version number or become a base model.

## What V5 trains

V5 is a roughly 3.1 million parameter residual CNN with global-pooling blocks.
The FP32 ONNX export is about 12 MiB and has a hard limit of 15 MiB. One shared,
strength-independent trunk learns the board. The nominal rank is injected only
into the policy head, so Japanese settlement cannot change with bot strength.

The model learns:

- rank-conditioned move policy and pass behavior;
- side-to-move win value;
- a score distribution, expected lead, and score uncertainty for intermediate
  evaluation;
- fixed-color ownership (`-1 Black`, `+1 White`);
- Black territory, White territory, and neutral/dame points;
- alive, dead, seki, and unsettled group status;
- a compatibility survival output for the existing settlement UI.

All settlement output remains `proposal-only`. The server rulebook and player
agreement remain authoritative for a final Japanese result.

## Efficient KataGo curriculum

Each game first uses a cheap one-visit human-policy query. Multiple games submit
queries concurrently to one KataGo process, allowing its neural evaluator to
batch work. Deep ownership and score queries are reserved for:

- positions 2, 4, 8, 16, and 32 plies before the end;
- endgame and dame;
- ko, atari, false-eye, snapback, dead-invasion, and seki candidates.

The preset controls deep and hard visit budgets. The week-long preset uses up to
256 visits for tactical settlement positions without spending that budget on
every opening move.

## V6 improvement curriculum

An inherited V6+ run does not repeat the V5 recipe unchanged. It uses a new
random seed and a new curriculum generation with:

- varied equal-strength, adjacent-rank, and distant-rank game pairings;
- deeper labels for close games and high-entropy policy decisions across all
  game phases, rather than filling the deep budget mostly with late false-eye
  and invasion candidates;
- explicit same-position policy targets at 600, 1500, and 2100 nominal Elo so
  the rank input cannot be ignored;
- stronger weighting for the win-value head and for rare seki/unsettled labels;
- a lower inherited-model learning rate, full V5-family replay, and a separate
  locked V5 replay gate to prevent catastrophic forgetting.

The training seed changes for every numbered run. Fresh shards are therefore
new games; earlier training shards are used only as protected replay. Test shards
remain locked and are never optimized.

KataGo analysis is configured as `SIDETOMOVE`. During generation, Black-to-move
ownership is therefore negated before storage. Dataset format 5 records the
fixed-color contract and tests cover both perspectives.

## Data splits and replay

Every compressed shard contains one game and exactly one permanent split:

- 80% training;
- 10% validation for scheduling and early stopping;
- 10% locked test data used only after training.

Splitting happens by complete game, never by individual position. V6+ train on
the training split from fresh and replay shards, validate on validation shards,
and leave every test shard locked. Shards are loaded one at a time, so a long
replay history does not need to fit in RAM.

Training uses eight board symmetries, AdamW, gradient clipping, exponential
moving-average weights, warmup plus cosine learning-rate decay, and early
stopping. Longer presets primarily add new independent games and deeper labels;
they do not merely repeat more epochs over a tiny dataset.

## Automatic quality gate

After export, the Lab evaluates the locked test split for all three board sizes.
It records policy loss/top-1 agreement, value error, score MAE in points,
ownership error, territory/status accuracy, seki false positives, confident
settlement coverage, and score-uncertainty calibration.

It then runs six visible-equivalent AI games against the preceding model: both
colors on 9x9, 13x13, and 19x19. KataGo evaluates each final position so neither
contestant scores its own match. A candidate is still available in the manual
Arena if the gate fails, but its metadata clearly records that it is not approved.

For V6+, approval additionally requires a measurable improvement on the fresh
locked curriculum, at least 60% in the direct six-game V5 arena, no material
regression on the V5 replay test, and no regression of the six per-Elo policy
slices or their rank-conditioning gain. The linked V4 artifact is required, and
V6 must also improve its combined locked objective and score at least 60% in a
separate direct V4 arena. The displayed 600–2100 values remain nominal until a
separate calibration league supplies enough real game evidence to assign ratings.

## Pause, resume, and stop

Pause and resume remain file-backed. Concurrent generators finish their current
KataGo query before pausing. Completed game shards and every completed epoch are
preserved. Safe stop also saves partial games; resuming regenerates that game
deterministically and replaces the partial shard only after a complete result is
available.

Training can continue if the browser is closed. Keep the small command window
open to reopen the Lab easily; the actual runner is a separate process.

## AI Arena

The existing Human-vs-AI and AI-vs-AI modes remain available. Completed V1–V4
checkpoints can still be loaded for comparison, while V5 checkpoints use the new
feature and output contract. Two passes trigger a proposal with dead and
uncertain groups and Japanese territory scoring. The proposal is not an official
result until both players agree.

## Files and commands

Runs live below:

```text
.cache/gostone-bot-training/control-center/runs/<run-id>/
├── config.json
├── state.json
├── events.jsonl
├── data/game-00000.npz
└── artifact/
    ├── training-progress.pt
    ├── gostone-japanese-v1.pt
    ├── gostone-japanese-v1.onnx
    └── gostone-japanese-v1.json
```

Useful command-line checks:

```powershell
python -m pip install -r training/gostone_bot/requirements.txt
npm run bot:train:test
npm run bot:train:smoke
npm run bot:lab
```

Do not copy a candidate into `public/bot-models/` merely because export worked.
Use the promotion result and manually inspect difficult endgames in AI Arena.
