# Gokyo Shumyo puzzle catalog

GoStone includes the first 200 positions from the 1812 historical Go problem
collection *Gokyo Shumyo*:

- Life: all 103 positions
- Death: all 71 positions
- Ko: the first 26 positions

The source work is in the public domain. Its bibliographic reference is NIJL
record `100344678`, DOI `10.20730/100344678`. The NIJL/Keio scan itself is
licensed CC BY-NC-SA 4.0, so GoStone does **not** copy, bundle, or display any
scan image. The app retains only board facts: stone coordinates, side to play,
historical section, and order.

The machine-readable position seed is the solution-free `gokyoshumyo.sgf`
classical transcription distributed as public-domain data in the `frank_go`
source repository. Its numbering, section labels, side to play, and a sample of
the diagrams were spot-checked against the NIJL original. It is not sourced
from a Go server, puzzle API, or a modern annotated edition.

All solution moves, principal variations, refutations, and approximate ranks
in `lib/puzzles/gokyoShumyoCatalog.json` are new GoStone data generated locally
with KataGo v1.17.1 and model `b10c384h6nbttflrs`. They do not reproduce a
modern book's answers or commentary. The generator is:

```text
node scripts/generate-gokyo-shumyo-catalog.mjs \
  --source <gokyoshumyo.sgf> \
  --binary <katago> \
  --model <b10c384h6nbttflrs.bin.gz> \
  --config docker/katago/bulk-puzzle-analysis.cfg \
  --output lib/puzzles/gokyoShumyoCatalog.json \
  --limit 200 \
  --visits 64 \
  --engine-version v1.17.1
```

The historical catalog uses the original 19×19 coordinates. It is seeded into
the existing private puzzle tables on first practice-catalog access, so solved
state and variation progress work identically on the website, Android, and iOS.
