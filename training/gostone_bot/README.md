# GoStone student bot training

This directory is an offline training pipeline. Nothing here is imported by the
Next.js production bundle. KataGo and its approximately 99 MB human-style model
act only as local teachers; the generated browser model is capped at 8 MiB.

## Design

- One rank-conditioned student model covers 9x9, 13x13, and 19x19.
- KataGo's human SL profiles provide policies for nominal 600-2100 Elo levels.
- KataGo's normal network provides the value target and search correction.
- The browser receives a normalized strength feature. Later move temperature and
  a small search budget can calibrate levels without downloading more models.
- Training data, teacher weights, checkpoints, and exports are ignored by Git.

The current laptop has no NVIDIA GPU. This pipeline therefore uses KataGo's
Eigen CPU backend and is designed for slow local dataset generation in separate
batches.
A smoke test proves the complete process; a useful production model still needs
many thousands of teacher positions and evaluation games.

## Setup and smoke test

```powershell
python -m pip install -r training/gostone_bot/requirements.txt
npm run bot:train:smoke
```

The teacher download is checksum-verified and stored below
`.cache/gostone-bot-training/`. It is never deployed or committed.

## Generate a pilot dataset

```powershell
npm run bot:dataset -- --games 12 --visits 8
```

For a first overnight run, start with 9x9 and 13x13. Full 19x19 games are much
slower on CPU:

```powershell
npm run bot:dataset -- --games 60 --board-sizes 9 13 --visits 8
npm run bot:train -- --epochs 30
```

Outputs are written to ignored directories:

- `training/gostone_bot/data/teacher-v1.npz`
- `training/gostone_bot/artifacts/v1/gostone-student-v1.onnx`
- `training/gostone_bot/artifacts/v1/gostone-student-v1.json`

Do not copy an artifact into `public/` until it has passed a fixed position test
suite and a bot-vs-bot calibration league. The nominal Elo inputs are training
targets, not measured ratings.
