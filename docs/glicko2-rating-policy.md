# GoStone Glicko-2 and rank policy v1

GoStone's isolated rating domain implements the algorithm described in Mark
Glickman's *Example of the Glicko-2 system*:
<https://www.glicko.net/glicko/glicko2.pdf>.

`glicko2-v1-tau-0.5` uses the published scale constant `173.7178`, default
system constant `tau = 0.5`, and convergence tolerance `0.000001`. The domain
accepts all results in one rating period against the same pre-period state. An
empty period preserves rating and volatility while increasing rating deviation
with the published inactivity step. Persistence, rating-period scheduling,
idempotency, and terminal-game eligibility remain responsibilities of the
later transactional integration.

The authoritative paper example is a 1500 rating, 200 rating deviation, and
0.06 volatility against 1400/30 (win), 1550/100 (loss), and 1700/300 (loss).
The expected new state is approximately 1464.06, 151.52, and 0.05999.

`gostone-rank-v1` is display-only and never an independently mutable player
state. Below 2000, kyu ranks use 50-point steps and are clamped to 30 kyu
through 1 kyu. At 2000 and above, dan ranks use 100-point steps and are clamped
to 1 dan through 9 dan. Its calibration anchors are:

- 500 = 30 kyu
- 1950 = 1 kyu
- 2000 = 1 dan
- 2800 = 9 dan

Consequently, the illustrative numerical value 1342 maps to 14 kyu under v1.
English notation is `14 kyu`; German notation is `14. Kyu`. Presentation
returns structured primary and secondary labels for rank-primary,
rating-primary, and equal both-display preferences.
