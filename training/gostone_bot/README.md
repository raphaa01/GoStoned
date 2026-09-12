# GoStone Local Training Lab

This directory is an offline, resumable KataGo-to-student training system. It is
never imported by the Next.js production bundle. Teacher weights, training data,
checkpoints, run state, and generated browser models are ignored by Git.

## Start with one double-click

1. Start Docker Desktop.
2. Double-click `Start-GoStone-Training.cmd` in the repository root.
3. The local control center opens at `http://127.0.0.1:4173`.
4. Choose a preset and CPU limit, then press **Start training**.

## Test a finished model

1. Let the training reach **Complete**.
2. Restart the Training Lab once if it was already open while these arena files
   were installed.
3. Open the **AI Arena** tab.
4. Select the finished model, board size, nominal Elo profile, and your color.
5. Press **Neue Testpartie** and play directly on the board.

The arena runs the generated PyTorch checkpoint locally. It filters occupied
points, suicide, and Japanese simple-ko repetitions before committing a move. Two
consecutive passes end the test game. The model then marks proposed dead groups
with red rings, uncertain groups with amber rings, and displays territory,
prisoners, komi, winner, and margin.

The proposal is intentionally not an authoritative result. Production GoStone
must apply the same Japanese scorer on the server after both players agree on the
dead groups. The six Elo labels are nominal training inputs until a calibration
league has measured their real strength.

## Compare two model versions live

1. Open **AI Arena** and choose **AI vs AI**.
2. Select the black and white checkpoints, board size, shared Elo profile, and
   the AI that should evaluate the final Japanese score, plus playback speed.
3. Press **Start live match**.
4. Watch each move appear on the board and in the complete move list. Use
   **Pause** and **Resume playback** whenever you want to inspect a position.

The browser requests exactly one locally calculated move at a time. A match is
therefore never simulated invisibly before its result appears. Colors should be
swapped in a second game when comparing model strength. Two passes trigger a
Japanese settlement proposal from the explicitly selected scoring AI. A safety
limit ends pathological games that never pass.

The browser may be closed while training. Keep the small command window open if
you want to reopen the page easily. The actual runner is a separate local process;
it does not consume Codex, Modal, Vercel, or Supabase resources.

The launcher checks Python, Docker, Python packages, and the local KataGo image.
The approximately 99 MB KataGo human teacher is checksum-verified and stored in
`.cache/gostone-bot-training/`. It is not part of the final browser model.

## Versions and repeated training

Approved real models are named `GoStone AI v1`, `GoStone AI v2`, and so on.
A candidate is released only after artifact validation and the KataGo quality
gate described below. Smoke runs are listed separately as `GoStone AI Technical
Test`; they verify the pipeline, but are never promoted or used as the base for a
real model.

A new real run uses a fresh random seed and starts with the newest successful
model weights. It therefore creates different KataGo games and continues learning
instead of reproducing the previous model. Every strength profile appears equally
often as Black and White on every board size over a complete 18-game cycle. Real presets also continue
9x9, 13x13, and 19x19 games far enough to include actual endgame positions.

Every fifth complete KataGo game is kept out of gradient training. After training,
the candidate and its base model are compared on those unseen positions across
policy, value, score, ownership, and stone-survival outputs. A candidate must
improve the combined score by at least 0.5 percent and may not regress any single
output by more than 3 percent. A rejected candidate remains resumable, but is not
shown as a released model. Its two weakest outputs receive extra loss weight on
the next resume. This prevents a demonstrably worse run from silently replacing
the previous model; AI-vs-AI calibration is still recommended before production.

## Model contract

- Japanese territory rules only, with 6.5 komi.
- 9x9, 13x13, and 19x19 from one model.
- Rank-conditioned policies for nominal 600, 900, 1200, 1500, 1800, and 2100 Elo.
- Policy, pass, win value, normalized score lead, per-point ownership, and
  per-stone survival outputs.
- Prisoner counts and recent game state are model inputs because Japanese scoring
  cannot be reconstructed from the final board alone.
- The exported ONNX artifact has a hard limit of 8 MiB.
- Dead/alive thresholds deliberately preserve an `uncertain` state for seki, ko,
  and unresolved capturing races.
- Settlement is a proposal only. The application server must calculate Japanese
  territory from the agreed dead groups, neutral seki regions, prisoners, and komi.

Nominal Elo inputs are training targets, not measured ratings. A calibration
league is required before displaying ratings publicly.

## Safe controls and resume

The control center supports pause, resume, and safe stop. Completed games are
stored as independent compressed shards. During neural-network training, an
atomic checkpoint is written after every batch, including optimizer state and the
exact epoch/batch position. After a restart, **Resume** continues from that point.
If a stop is requested inside KataGo game generation, the already analyzed
partial game is retained as valid training data.

The **Saved checkpoints** selector lists older stopped runs as well as the newest
run. Select the older run and press **Use selected run** before **Resume**. This is
important when a later smoke test became the current run: the smoke test never
absorbs or replaces the data of an earlier long run.

Runs live below:

```text
.cache/gostone-bot-training/control-center/runs/<run-id>/
├── config.json
├── state.json
├── events.jsonl
├── data/
│   └── game-00000.npz
└── artifact/
    ├── training-progress.pt
    ├── gostone-japanese-v1.pt
    ├── gostone-japanese-v1.onnx
    └── gostone-japanese-v1.json
```

## Command-line alternatives

```powershell
python -m pip install -r training/gostone_bot/requirements.txt
npm run bot:train:smoke
npm run bot:train:test
npm run bot:lab
```

Do not copy a generated model into `public/` until fixed endgame positions,
AI-vs-AI games, pass behavior, and group-settlement confidence have been
evaluated. A successful export proves the technical contract, not playing strength.
