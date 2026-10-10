# Learning turns: website, Android and iOS

The same curriculum and LessonPlayer serve all three clients.

## Interaction contract

- A correct learner move plays exactly the first authored opponent reply immediately.
- A following `play` step with `continuePosition: true`, the same size and the same learner colour becomes interactive immediately. No Continue or Show move is needed. The board, history and captures carry forward.
- A new position/task waits for Continue. Finishing a lesson still requires explicit completion.
- Additional trainer plies in a demonstration require one Show next move click each, including passes. There is no multi-move batch. The board remains locked during the demonstration.
- The consequence of the preceding exchange stays visible alongside the next own instruction.
- Restart restores the current decision's starting position. Resuming without a full move record restarts the short continuous sequence.

## Colour contract

`stableLessonColor` fixes the learner's colour per lesson. Independent exercises authored for the opposite side swap their complete stone colours, ko predecessor and colour words in both German and English copy. Coordinates and rule-engine answers do not change. No client/server permissions are affected.

The alternating-turn introduction is authored as Black → automatic White → learner Black. The Ko introduction demonstrates Black's capture, then keeps the learner as White for the illegal immediate recapture, intervening move and legal recapture. Other stages 1–3 retain their authored concepts, order and positions; only a necessary opposite-colour exercise is presented with swapped roles.

## Practice

Stage-four introductions each contain at least five distinct practice positions. Net and snapback include four orientations plus a genuinely different larger group, with complete learner/opponent lines. Tests assert actual capture counts (three or four), the single-stone sacrifice, legality, ko, liberty counts and continuous board history. The route still has 120 nodes; these are additional exercises inside existing lessons, not new overwhelming route entries.

## Verification

- Unit tests cover all 120 lessons' fixed learner colours and every continuous transition.
- Shared full-path browser verification solves every lesson on website and mobile, compares the board immediately after each learner move and first reply, checks trainer continuations and completes actual browser-worker games.
- Mobile phone/desktop tests specifically cover uninterrupted ladder, five nets, five snapbacks, Ko and the stage-three mixed challenge.
- Stage-three life/death and commented-game tests assert that the first reply is automatic but a later trainer capture/move cannot occur before its own Show move click.
- CI runs the website path against isolated PostgreSQL, checking real account progress, scoring and persistence; mobile tests cover the bundled client used by Android and iOS.

iOS native compilation and physical-device responsiveness require macOS/Xcode and real devices; a successful shared bundle test does not claim those checks.
