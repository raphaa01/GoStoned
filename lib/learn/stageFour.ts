import type { LearnLesson, LessonStep } from "./curriculum";
import { b, w, p, t, task, mark, info, sequence, mirror, ladderSteps, DOUBLE_ATARI, SNAPBACK, NET, RACE } from "./laterLessonTools";
import { NET_PRACTICE, SNAPBACK_PRACTICE, rotatePractice } from "./tacticalPractice";

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
  { id: "s4-double-atari", stage: 4, title: t("Double Atari", "Double atari"), minutes: 4, steps: [double,
    ...rotatePractice([double], 1, "vertical"),
    ...[0, 1, 2].flatMap((rotation) => rotatePractice([{...double,id:"diagonal-groups",stones:[w(1,1),w(2,2),b(1,0),b(1,2),b(2,3)],targets:[p(2,1)]}], rotation, `diagonal-${rotation}`)),
  ] },
  { id: "s4-ladder", stage: 4, title: t("Leiter", "Ladder"), minutes: 5, steps: [
    ...ladderSteps(),
    ...[1, 2, 3].flatMap((rotation) => rotatePractice([{ ...ladderSteps().at(-1)!, continuePosition: false,
      body: t("Die Leiter erreicht den Rand. Nimm die letzte Freiheit der weißen Gruppe.", "The ladder reaches the edge. Take the white group's last liberty."),
    }], rotation, `edge-${rotation}`)),
    mirror({ ...ladderSteps().at(-1)!, continuePosition: false }, "edge-mirrored"),
  ] },
  { id: "s4-ladder-breaker", stage: 4, title: t("Eine Leiter brechen", "Ladder breaker"), minutes: 3, steps: [
    ...ladderSteps(true), mark("support", 7, [w(1, 1), b(0, 1), b(1, 0), b(2, 0), w(4, 2)], [p(4, 2)], t("Welche weiße Unterstützung liegt auf dem Weg der Leiter?", "Which supporting white stone lies in the ladder's path?"), t("Dieser Stein gibt Weiß beim Verbinden zusätzliche Freiheiten. Prüfe solche Steine vor dem Verfolgen.", "Connecting to this stone gives White extra liberties. Check for such stones before chasing."), "stone"),
    ...[1, 2, 3].flatMap((rotation) => rotatePractice([{ ...ladderSteps(true)[2], continuePosition: false,
      body: t("Weiß hat einen Unterstützungsstein auf dem Weg der Leiter. Spiele Atari und prüfe, wie viele Freiheiten die Verbindung ergibt.", "White has a supporting stone in the ladder's path. Play atari and check how many liberties the connection gives."),
      success: t("Weiß verbindet mit dem Unterstützungsstein und hat jetzt vier Freiheiten. Die Leiter ist gebrochen.", "White connects to the supporting stone and now has four liberties. The ladder is broken."),
    }], rotation, `breaker-${rotation}`)),
    mirror({ ...ladderSteps(true)[2], continuePosition: false, body: t("Prüfe vor dem Verfolgen den weißen Unterstützungsstein. Spiele Atari: Kann Weiß sich anschließen?", "Check the supporting white stone before chasing. Play atari: can White connect?"), success: t("Die Verbindung gibt Weiß vier Freiheiten. Ein weiteres Atari ist nicht mehr möglich: Die Leiter ist gebrochen.", "Connecting gives White four liberties. Another atari is no longer possible: the ladder is broken.") }, "breaker-mirrored"),
  ] },
  { id: "s4-net", stage: 4, title: t("Netz / Geta", "Net / geta"), minutes: 5, steps: [
    info("net-term", 5, NET, t("Ein Netz schließt Fluchtwege mit Abstand ein. Du spielst Schwarz: Setze die Umfassung und stoppe danach die Fluchtversuche von Weiß.", "A net encloses escape routes from a distance. You play Black: set the enclosure, then stop White's escape attempts.")),
    ...NET_PRACTICE,
  ] },
  { id: "s4-snapback", stage: 4, title: t("Snapback", "Snapback"), minutes: 5, steps: [
    info("snapback-term", 5, SNAPBACK, t("Beim Snapback opferst du einen Stein und schlägst danach eine größere Gruppe zurück. Prüfe nach dem gegnerischen Schlag ihre letzte Freiheit.", "In snapback, you sacrifice one stone and then recapture a larger group. After the opponent captures, check that group's last liberty.")),
    ...SNAPBACK_PRACTICE,
  ] },
  { id: "s4-throw-in", stage: 4, title: t("Einwerfen", "Throw-in"), minutes: 5, steps: [
    info("purpose", 5, SNAPBACK, t("Der neue Stein am Rand soll nicht überleben. Er zwingt Weiß zum Schlagen und nimmt der weißen Form Platz.", "The new edge stone is not meant to survive. It forces White to capture and reduces White's space.")),
    ...snap.map((step, index) => ({ ...step, id: `throw-${index}`, success: index === 0 ? t("Der geopferte Stein ist weg. Weiß hat jetzt weniger Freiheiten für die ganze Gruppe.", "The sacrificed stone is gone. White now has fewer liberties for the whole group.") : step.success })),
    ...SNAPBACK_PRACTICE.filter((step) => step.id.startsWith("right-") || step.id.startsWith("bottom-") || step.id.startsWith("left-") || step.id.startsWith("four-")),
  ] },
  { id: "s4-shortage", stage: 4, title: t("Eine Freiheit zu wenig", "Shortage of liberties"), minutes: 4, steps: [
    mark("count", 5, snap[1].stones!, [p(1, 0)], t("Markiere die Freiheiten der weißen Eckgruppe aus drei Steinen.", "Mark the liberties of White's three-stone corner group."), t("Nur eine Freiheit bleibt. Der weiße Schlag war deshalb keine sichere Rettung.", "Only one liberty remains. White's capture was therefore not a safe rescue.")),
    { ...snap[1], id: "punish", continuePosition: false },
    mirror({ ...snap[1], continuePosition: false }, "other-side"),
    ...rotatePractice([{ ...snap[1], continuePosition: false }], 1, "bottom-edge"),
    ...rotatePractice([{ ...snap[1], continuePosition: false }], 2, "lower-corner"),
    ...rotatePractice([{ ...snap[1], continuePosition: false }], 3, "left-edge"),
  ] },
  { id: "s4-semeai", stage: 4, title: t("Schlagrennen / Semeai", "Capturing race / semeai"), minutes: 5, steps: [
    mark("black-liberties", 5, RACE, [p(0, 0), p(1, 0), p(0, 2), p(1, 2)], t("Die schwarze Zweiergruppe links kämpft gegen die weiße Zweiergruppe. Markiere Schwarz' Freiheiten.", "The black pair on the left races against the white pair. Mark Black's liberties."), t("Schwarz: vier Freiheiten.", "Black: four liberties.")),
    mark("white-liberties", 5, RACE, [p(2, 0), p(2, 2), p(3, 2)], t("Markiere jetzt die Freiheiten der weißen Zweiergruppe.", "Now mark the white pair's liberties."), t("Weiß: drei Freiheiten. Schwarz beginnt und kann zuerst schlagen.", "White: three liberties. Black moves first and can capture first.")),
    ...race,
    ...[1, 2, 3].flatMap((rotation) => rotatePractice(race.map((step) => ({ ...step,
      body: t("Nimm eine äußere Freiheit der weißen Zweiergruppe. Schlage sie, bevor Schwarz seine letzte Freiheit verliert.", "Take an outside liberty of the white pair. Capture it before Black loses its final liberty."),
    })), rotation, `race-${rotation}`)),
    ...race.map((step, index) => ({ ...mirror(step, `race-mirrored-${index}`), continuePosition: index > 0,
      body: t("Nimm eine äußere Freiheit von Weiß. Nach der Antwort ist wieder Schwarz am Zug; schlage zuerst.", "Take an outside liberty of White. After the reply Black moves again; capture first."),
    })),
    mark("shared", 5, [b(1, 1), w(2, 2)], [p(2, 1), p(1, 2)], t("Hier sind zwei Freiheiten gemeinsam: Sie grenzen direkt an beide Farben. Markiere nur diese.", "Here two liberties are shared: they touch both colors directly. Mark only those."), t("Eine gemeinsame Freiheit gehört beiden Gruppen. Ihr Besetzen nimmt auch der eigenen Gruppe eine Freiheit.", "A shared liberty belongs to both groups. Filling it also takes a liberty from your own group.")),
  ] },
  { id: "s4-sacrifice", stage: 4, title: t("Ein Stein als Opfer", "Sacrifice"), minutes: 5, steps: [
    ...snap.map((step, index) => ({ ...step, id: `trade-${index}`, body: index === 0 ? t("Ein eigener Stein gegen drei gegnerische: Bereite den Tausch am oberen Rand vor.", "One own stone for three opposing stones: prepare the trade on the top edge.") : step.body })),
    ...SNAPBACK_PRACTICE.filter((step) => step.id.startsWith("right-") || step.id.startsWith("bottom-") || step.id.startsWith("left-") || step.id.startsWith("four-")),
    info("trade-result", 5, [b(1, 0), w(2, 0), b(2, 1), b(0, 2), b(1, 2), b(2, 2)], t("Ein Opfer wird nach dem Ergebnis beurteilt, nicht danach, ob jeder eigene Stein bleibt. Hier gewinnt Schwarz zwei Gefangene mehr als Weiß.", "Judge a sacrifice by its result, not by whether every stone survives. Here Black gains two more prisoners than White.")),
  ] },
  { id: "s4-tesuji", stage: 4, title: t("Was heißt Tesuji?", "What is a tesuji?"), minutes: 4, steps: [
    info("term", 5, NET, t("Tesuji nennt man einen besonders wirkungsvollen lokalen Zug. Netz, Einwerfen und Snapback können solche Züge sein; Tesuji ist keine einzelne Zugart.", "A tesuji is a particularly effective local move. Nets, throw-ins, and snapbacks can be tesuji; it is not one specific move type.")), net, { ...snap[1], id: "recapture", continuePosition: false },
    double, { ...race.at(-1)!, id: "race-tesuji", continuePosition: false },
    ...rotatePractice([{ ...net, body: t("Weiß hat zwei Ausgänge. Schließe beide mit einem diagonalen Zug ein.", "White has two exits. Enclose both with one diagonal move."), wrong: t("Ein direktes Atari lässt den anderen Ausgang offen. Suche die diagonale Umfassung.", "A direct atari leaves the other exit open. Find the diagonal enclosure.") }], 2, "net-tesuji"),
  ] },
  { id: "s4-mix", stage: 4, title: t("Taktik-Mix", "Tactics mix"), minutes: 5, steps: mixed },
  { id: "s4-challenge", stage: 4, title: t("Taktik-Challenge", "Tactics challenge"), minutes: 5, challenge: true, steps: [
    ...mixed.map((step, index) => ({ ...mirror(step, `challenge-${index}`), continuePosition: index === 3, body: index === 0 ? t("Beide weißen Gruppen haben zwei Freiheiten.","Both white groups have two liberties.") : index === 1 ? t("Weiß hat zwei Ausgänge, die innerhalb der schwarzen Umfassung liegen.","White has two exits within Black's surrounding stones.") : index === 4 ? t("Ein weiterer weißer Stein liegt auf dem Weg der Verfolgung.","Another white stone lies along the chase.") : t("Prüfe die Freiheiten der weißen Randgruppe.","Check the white edge group's liberties."), task: index === 4 ? t("Verfolge Weiß und prüfe, ob die Gruppe entkommt.", "Chase White and check whether it escapes.") : index === 1 ? t("Halte Weiß eingeschlossen.", "Keep White enclosed.") : index === 2 ? t("Bereite einen größeren Rückschlag vor.", "Prepare a larger recapture.") : index === 0 ? t("Bedrohe beide weißen Gruppen gleichzeitig.", "Threaten both white groups at once.") : t("Schlage die bedrohte weiße Gruppe.", "Capture the threatened white group."), wrong:t("Prüfe, welche weißen Freiheiten der Zug nimmt und welche Ausgänge danach bleiben.","Check which White liberties the move takes and which exits remain."), success:index===4 ? t("Weiß verbindet mit seinem Unterstützungsstein und entkommt der Leiter.","White connects to its supporting stone and escapes the ladder.") : step.success })),
  ] },
];
