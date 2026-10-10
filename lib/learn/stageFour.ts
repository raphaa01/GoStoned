import type { LearnLesson, LessonStep } from "./curriculum";
import { b, w, p, t, task, mark, info, sequence, mirror, ladderSteps, DOUBLE_ATARI, SNAPBACK, NET, RACE } from "./laterLessonTools";

const double = task("two-groups", 5, DOUBLE_ATARI, "black", [p(2, 2)],
  t("Die beiden weißen Gruppen haben je zwei Freiheiten. Ein Punkt grenzt an beide.", "Each white group has two liberties. One point touches both."),
  t("Beide Gruppen stehen jetzt im Atari. Das heißt Double Atari; Weiß kann nicht beide mit einem Zug retten.", "Both groups are now in atari. This is double atari; White cannot save both with one move."),
  t("Nimm eine Freiheit, die beide weißen Gruppen gemeinsam haben.", "Take a liberty shared by both white groups."));
const net = task("surround", 5, NET, "black", [p(2, 2)],
  t("Weiß kann nach rechts oder unten laufen. Schließe beide Ausgänge mit einem diagonalen Zug ein.", "White can run right or down. Enclose both exits with one diagonal move."),
  t("Dieses Einschließen heißt Netz oder Geta. Weiß wird nicht bei jedem Zug direkt ins Atari gesetzt.", "This surrounding move is a net, or geta. White is not put directly into atari on every move."),
  t("Direktes Verfolgen öffnet den anderen Ausgang. Suche den Punkt diagonal rechts unter Weiß.", "Chasing directly leaves the other exit. Look diagonally below and right of White."));
const snap = sequence("snapback", 5, SNAPBACK, "black", [
  { move: p(1, 0), replies: [p(0, 0)], body: t("Setze zwischen die weißen Steine am oberen Rand. Weiß wird diesen neuen Stein schlagen.", "Play between the white stones on the top edge. White will capture your new stone."), success: t("Weiß hat einen Stein geschlagen. Prüfe jetzt die Freiheiten der verbundenen weißen Dreiergruppe.", "White captured one stone. Now check the liberties of the connected three-stone white group.") },
  { move: p(1, 0), body: t("Die weiße Dreiergruppe hat nur eine Freiheit. Spiele auf den gerade frei gewordenen Punkt.", "The white three-stone group has only one liberty. Play on the point that just became empty."), success: t("Schwarz schlägt drei Steine zurück. Das ist Snapback, kein Ko: Es entsteht eine andere Stellung.", "Black captures three stones in return. This is snapback, not ko: it creates a different position.") },
]);
const race = sequence("race", 5, RACE, "black", [
  { move: p(2, 0), replies: [p(0, 2)], body: t("Nimm zuerst die obere äußere Freiheit von Weiß. Weiß nimmt eine von Schwarz.", "First take White's upper outside liberty. White takes one of Black's."), success: t("Weiß hat noch zwei Freiheiten, Schwarz noch drei.", "White has two liberties left; Black has three.") },
  { move: p(2, 2), replies: [p(1, 2)], body: t("Nimm die Freiheit direkt unter dem linken weißen Stein.", "Take the liberty immediately below White's left stone."), success: t("Weiß: eine Freiheit. Schwarz: zwei. Schwarz ist noch nicht im Atari.", "White: one liberty. Black: two. Black is not in atari yet.") },
  { move: p(3, 2), body: t("Schlage die weiße Zweiergruppe, bevor sie Schwarz schlagen kann.", "Capture the white pair before it can capture Black."), success: t("Schwarz gewinnt dieses Rennen. Solche Schlagrennen heißen Semeai.", "Black wins this race. Capturing races are called semeai.") },
]);
const mixed: LessonStep[] = [
  { ...double, id: "decision-1", body: t("Ein Zug bedroht beide weißen Gruppen. Finde ihn.", "Find the move that threatens both white groups.") },
  { ...net, id: "decision-2", body: t("Halte Weiß eingeschlossen, ohne direkt hinterherzulaufen.", "Keep White enclosed without chasing directly behind it.") },
  { ...snap[0], id: "decision-3", body: t("Weiß steht eng am Rand. Finde den Zug, der einen größeren Rückschlag vorbereitet.", "White is cramped at the edge. Find the move that prepares a larger recapture."), continuePosition: false },
  { ...snap[1], id: "decision-4", body: t("Nimm jetzt die letzte Freiheit der weißen Gruppe.", "Now take the white group's last liberty."), continuePosition: true },
  { ...ladderSteps(true)[2], id: "decision-5", continuePosition: false, body: t("Weiß kann sich an einen Stein weiter rechts anschließen. Verfolge und prüfe das Ergebnis.", "White can connect to a stone further right. Chase and check the result.") },
  { ...race[2], id: "decision-6", continuePosition: false, body: t("Beide Gruppen sind bedroht. Welche gegnerische Freiheit kannst du zuerst nehmen?", "Both groups are threatened. Which opposing liberty can you take first?") },
];

export const STAGE_FOUR: readonly LearnLesson[] = [
  { id: "s4-double-atari", stage: 4, title: t("Double Atari", "Double atari"), minutes: 3, steps: [double, {...double,id:"diagonal-groups",stones:[w(1,1),w(2,2),b(1,0),b(1,2),b(2,3)],targets:[p(2,1)]}] },
  { id: "s4-ladder", stage: 4, title: t("Leiter", "Ladder"), minutes: 4, steps: ladderSteps() },
  { id: "s4-ladder-breaker", stage: 4, title: t("Eine Leiter brechen", "Ladder breaker"), minutes: 3, steps: [
    ...ladderSteps(true), mark("support", 7, [w(1, 1), b(0, 1), b(1, 0), b(2, 0), w(4, 2)], [p(4, 2)], t("Welche weiße Unterstützung liegt auf dem Weg der Leiter?", "Which supporting white stone lies in the ladder's path?"), t("Dieser Stein gibt Weiß beim Verbinden zusätzliche Freiheiten. Prüfe solche Steine vor dem Verfolgen.", "Connecting to this stone gives White extra liberties. Check for such stones before chasing."), "stone"),
  ] },
  { id: "s4-net", stage: 4, title: t("Netz / Geta", "Net / geta"), minutes: 3, steps: [net,
    ...sequence("net-proof", 5, [...NET, b(2, 2)], "white", [
      { move: p(2, 1), replies: [p(2, 0)], body: t("Spiele jetzt Weiß. Versuche, nach rechts zu entkommen.", "Now play White. Try escaping to the right."), success: t("Schwarz blockiert oben. Weiß bleibt nur die untere Freiheit.", "Black blocks above. White has only the lower liberty left.") },
      { move: p(1, 2), replies: [p(0, 2)], body: t("Weiß muss nach unten erweitern. Versuche diesen Ausweg.", "White must extend downward. Try that exit."), success: t("Schwarz schließt links und schlägt die ganze Gruppe. Das Netz hält.", "Black closes the left exit and captures the group. The net holds.") },
    ])] },
  { id: "s4-snapback", stage: 4, title: t("Snapback", "Snapback"), minutes: 3, steps: [...snap, mirror(snap[1], "recapture-other-edge")] },
  { id: "s4-throw-in", stage: 4, title: t("Einwerfen", "Throw-in"), minutes: 3, steps: [
    info("purpose", 5, SNAPBACK, t("Der neue Stein am Rand soll nicht überleben. Er zwingt Weiß zum Schlagen und nimmt der weißen Form Platz.", "The new edge stone is not meant to survive. It forces White to capture and reduces White's space.")),
    ...snap.map((step, index) => ({ ...step, id: `throw-${index}`, success: index === 0 ? t("Der geopferte Stein ist weg. Weiß hat jetzt weniger Freiheiten für die ganze Gruppe.", "The sacrificed stone is gone. White now has fewer liberties for the whole group.") : step.success })),
  ] },
  { id: "s4-shortage", stage: 4, title: t("Eine Freiheit zu wenig", "Shortage of liberties"), minutes: 3, steps: [
    mark("count", 5, snap[1].stones!, [p(1, 0)], t("Markiere die Freiheiten der weißen Eckgruppe aus drei Steinen.", "Mark the liberties of White's three-stone corner group."), t("Nur eine Freiheit bleibt. Der weiße Schlag war deshalb keine sichere Rettung.", "Only one liberty remains. White's capture was therefore not a safe rescue.")),
    { ...snap[1], id: "punish", continuePosition: false },
    mirror({ ...snap[1], continuePosition: false }, "other-side"),
  ] },
  { id: "s4-semeai", stage: 4, title: t("Schlagrennen / Semeai", "Capturing race / semeai"), minutes: 4, steps: [
    mark("black-liberties", 5, RACE, [p(0, 0), p(1, 0), p(0, 2), p(1, 2)], t("Die schwarze Zweiergruppe links kämpft gegen die weiße Zweiergruppe. Markiere Schwarz' Freiheiten.", "The black pair on the left races against the white pair. Mark Black's liberties."), t("Schwarz: vier Freiheiten.", "Black: four liberties.")),
    mark("white-liberties", 5, RACE, [p(2, 0), p(2, 2), p(3, 2)], t("Markiere jetzt die Freiheiten der weißen Zweiergruppe.", "Now mark the white pair's liberties."), t("Weiß: drei Freiheiten. Schwarz beginnt und kann zuerst schlagen.", "White: three liberties. Black moves first and can capture first.")),
    ...race,
    mark("shared", 5, [b(1, 1), w(2, 2)], [p(2, 1), p(1, 2)], t("Hier sind zwei Freiheiten gemeinsam: Sie grenzen direkt an beide Farben. Markiere nur diese.", "Here two liberties are shared: they touch both colors directly. Mark only those."), t("Eine gemeinsame Freiheit gehört beiden Gruppen. Ihr Besetzen nimmt auch der eigenen Gruppe eine Freiheit.", "A shared liberty belongs to both groups. Filling it also takes a liberty from your own group.")),
  ] },
  { id: "s4-sacrifice", stage: 4, title: t("Ein Stein als Opfer", "Sacrifice"), minutes: 3, steps: [
    ...snap.map((step, index) => ({ ...step, id: `trade-${index}`, body: index === 0 ? t("Ein eigener Stein gegen drei gegnerische: Bereite den Tausch am oberen Rand vor.", "One own stone for three opposing stones: prepare the trade on the top edge.") : step.body })),
    info("trade-result", 5, [b(1, 0), w(2, 0), b(2, 1), b(0, 2), b(1, 2), b(2, 2)], t("Ein Opfer wird nach dem Ergebnis beurteilt, nicht danach, ob jeder eigene Stein bleibt. Hier gewinnt Schwarz zwei Gefangene mehr als Weiß.", "Judge a sacrifice by its result, not by whether every stone survives. Here Black gains two more prisoners than White.")),
  ] },
  { id: "s4-tesuji", stage: 4, title: t("Was heißt Tesuji?", "What is a tesuji?"), minutes: 3, steps: [
    info("term", 5, NET, t("Tesuji nennt man einen besonders wirkungsvollen lokalen Zug. Netz, Einwerfen und Snapback können solche Züge sein; Tesuji ist keine einzelne Zugart.", "A tesuji is a particularly effective local move. Nets, throw-ins, and snapbacks can be tesuji; it is not one specific move type.")), net, { ...snap[1], id: "recapture", continuePosition: false },
  ] },
  { id: "s4-mix", stage: 4, title: t("Taktik-Mix", "Tactics mix"), minutes: 5, steps: mixed },
  { id: "s4-challenge", stage: 4, title: t("Taktik-Challenge", "Tactics challenge"), minutes: 5, challenge: true, steps: [
    ...mixed.map((step, index) => ({ ...mirror(step, `challenge-${index}`), continuePosition: index === 3, body: index === 0 ? t("Beide weißen Gruppen haben zwei Freiheiten.","Both white groups have two liberties.") : index === 1 ? t("Weiß hat zwei Ausgänge, die innerhalb der schwarzen Umfassung liegen.","White has two exits within Black's surrounding stones.") : index === 4 ? t("Ein weiterer weißer Stein liegt auf dem Weg der Verfolgung.","Another white stone lies along the chase.") : t("Prüfe die Freiheiten der weißen Randgruppe.","Check the white edge group's liberties."), task: index === 4 ? t("Verfolge Weiß und prüfe, ob die Gruppe entkommt.", "Chase White and check whether it escapes.") : index === 1 ? t("Halte Weiß eingeschlossen.", "Keep White enclosed.") : index === 2 ? t("Bereite einen größeren Rückschlag vor.", "Prepare a larger recapture.") : index === 0 ? t("Bedrohe beide weißen Gruppen gleichzeitig.", "Threaten both white groups at once.") : t("Schlage die bedrohte weiße Gruppe.", "Capture the threatened white group."), wrong:t("Prüfe, welche weißen Freiheiten der Zug nimmt und welche Ausgänge danach bleiben.","Check which White liberties the move takes and which exits remain."), success:index===4 ? t("Weiß verbindet mit seinem Unterstützungsstein und entkommt der Leiter.","White connects to its supporting stone and escapes the ladder.") : step.success })),
  ] },
];
