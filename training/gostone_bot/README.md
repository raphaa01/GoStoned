# GoStone Local Training Lab

This directory is an offline, resumable KataGo-to-student training system. It is
never imported by the Next.js production bundle. Teacher weights, training data,
checkpoints, run state, and generated browser models are ignored by Git.

## Start with one double-click

1. Start Docker Desktop.
2. Double-click `Start-GoStone-Training.cmd` in the repository root.
3. The local control center opens at `http://127.0.0.1:4173`.
4. Choose a preset and CPU limit, then press **Training starten**.

## Test a finished model

1. Let the training reach **Fertig**.
2. Restart the Training Lab once if it was already open while these arena files
   were installed.
3. Open the **Testarena** tab.
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

The browser may be closed while training. Keep the small command window open if
you want to reopen the page easily. The actual runner is a separate local process;
it does not consume Codex, Modal, Vercel, or Supabase resources.

The launcher checks Python, Docker, Python packages, and the local KataGo image.
The approximately 99 MB KataGo human teacher is checksum-verified and stored in
`.cache/gostone-bot-training/`. It is not part of the final browser model.

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
stored as independent compressed shards, and every completed epoch has a training
checkpoint. After a restart, **Fortsetzen** reuses both. If a stop is requested
inside a game, the already analyzed partial game is retained as valid training
data.

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
bot-vs-bot games, pass behavior, and group-settlement confidence have been
evaluated. A successful export proves the technical contract, not playing strength.
