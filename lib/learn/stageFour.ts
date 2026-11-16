import type { LearnLesson, LessonStep } from "./curriculum";
import { b, w, p, t, task, mark, info, sequence, eyePosition, ladderSteps, DOUBLE_ATARI, NET, RACE, SNAPBACK } from "./laterLessonTools";
import { NET_PRACTICE, SNAPBACK_PRACTICE } from "./tacticalPractice";

const double = task("two-groups", 5, DOUBLE_ATARI, "black", [p(2, 2)],
  t("Die beiden weißen Gruppen haben je zwei Freiheiten. Ein Punkt grenzt an beide.", "Each white group has two liberties. One point touches both."),
  t("Beide Gruppen stehen jetzt im Atari. Das heißt Double Atari; Weiß kann nicht beide mit einem Zug retten.", "Both groups are now in atari. This is double atari; White cannot save both with one move."),
  t("Nimm eine Freiheit, die beide weißen Gruppen gemeinsam haben.", "Take a liberty shared by both white groups."));
const race = sequence("race", 5, RACE, "black", [
  { move: p(2, 0), replies: [p(0, 2)], body: t("Nimm zuerst die obere äußere Freiheit von Weiß. Weiß nimmt eine von Schwarz.", "First take White's upper outside liberty. White takes one of Black's."), success: t("Weiß hat noch zwei Freiheiten, Schwarz noch drei.", "White has two liberties left; Black has three.") },
  { move: p(2, 2), replies: [p(1, 2)], body: t("Nimm die Freiheit direkt unter dem linken weißen Stein.", "Take the liberty immediately below White's left stone."), success: t("Weiß: eine Freiheit. Schwarz: zwei. Schwarz ist noch nicht im Atari.", "White: one liberty. Black: two. Black is not in atari yet.") },
  { move: p(3, 2), body: t("Schlage die weiße Zweiergruppe, bevor sie Schwarz schlagen kann.", "Capture the white pair before it can capture Black."), success: t("Schwarz gewinnt dieses Rennen. Solche Schlagrennen heißen Semeai.", "Black wins this race. Capturing races are called semeai.") },
]);

const eye = eyePosition([p(2, 3), p(3, 3), p(4, 3)]);
const throwIn = sequence("throw-in", 7, eye, "white", [
  {
    move: p(3, 3), replies: [p(2, 3)],
    body: t("Schwarz kann im länglichen Augenraum zwei Augen bilden. Besetze als Weiß den Punkt, der den Raum teilen würde.", "Black can make two eyes in this long eye space. As White, occupy the point that would divide it."),
    success: t("Schwarz hat den linken Innenpunkt gefüllt. Der weiße Einwurf nimmt Schwarz die Möglichkeit, den Raum zu teilen.", "Black filled the left interior point. White's throw-in prevents Black from dividing the space."),
  },
  {
    move: p(4, 3),
    body: t("Die schwarze Wand hat im Inneren ihre letzte Freiheit. Schlage die Wand, bevor sie den Einwurf schlagen kann.", "The black wall has one liberty left inside. Capture the wall before it can take the throw-in."),
    success: t("Die Wand fällt. Beim Einwerfen zählt, was der Stein im gegnerischen Augenraum verändert.", "The wall falls. This throw-in works because it changes the opponent's eye space."),
  },
]);

const sharedCorner = [b(0, 0), b(1, 1), w(0, 2), w(1, 2), w(2, 0), w(2, 1), w(0, 1)];
const sacrifice = sequence("leave-one", 7, [b(0, 4), b(2, 3), b(2, 4), b(3, 5), w(0, 3), w(1, 4), w(1, 3), w(2, 2), w(3, 3), w(2, 5)], "black", [
  {
    move: p(3, 4), replies: [p(0, 5)],
    body: t("Ein schwarzer Randstein und die schwarze Zweiergruppe stehen im Atari. Hilf der größeren Gruppe, indem du sie an den Stein rechts unten anschließt.", "A black edge stone and a pair of black stones are both in atari. Save the pair by connecting it to the stone below and right."),
    success: t("Weiß nimmt den einzelnen Randstein. Schwarz hat dafür seine größere Gruppe verbunden und gerettet.", "White takes the single edge stone. Black connected and saved its larger group."),
  },
]);

const edgeChase = sequence("edge-chase", 5, [w(1, 0), w(2, 0), b(1, 1), b(2, 1), b(3, 1)], "black", [
  {
    move: p(0, 0), replies: [p(3, 0)],
    body: t("Weiß kann am oberen Rand nach links oder rechts laufen. Sperre zuerst dort ab, wo du unten noch keine Unterstützung hast.", "White can run left or right along the top edge. Block the side where you have no support underneath."),
    success: t("Weiß hat verlängert. Schwarz kontrolliert die Ausgänge darunter.", "White extended. Black controls the exits underneath."),
  },
  {
    move: p(4, 0),
    body: t("Wo endet die Flucht am Rand?", "Where does the edge escape end?"),
    success: t("Schwarz schlägt die weiße Gruppe. Durch die eigenen Steine darunter blieb der Flucht nur die erste Linie.", "Black captures the white group. The stones underneath restricted White's escape to the first line."),
  },
]);

const mixed: LessonStep[] = [
  mark("aim", 7, [w(2, 2), w(3, 3), b(2, 1), b(3, 4)], [p(3, 2), p(2, 3)],
    t("Welche leeren Punkte berühren beide weißen Gruppen? Markiere beide Kandidaten für ein Double Atari.", "Which empty points touch both white groups? Mark both candidates for a double atari."),
    t("Beide Punkte sind gemeinsam. Ein Zug dort droht erst dann mit dem Schlagen, wenn danach jede Gruppe nur noch eine Freiheit hat.", "Both points are shared. Playing on one threatens capture only if each group then has just one liberty.")),
  ...edgeChase,
];

const challenge: LessonStep[] = [
  task("challenge-double", 7, [b(2, 1), b(3, 2), w(2, 0), w(1, 1), w(3, 0), w(4, 1), w(4, 2), w(3, 3)], "white", [p(3, 1)],
    t("Weiß ist am Zug. Bedrohe die zwei getrennten schwarzen Steine gleichzeitig von oben.", "White to play. Threaten both separate black stones at once from above."),
    t("Beide schwarzen Steine stehen im Atari. Schwarz muss sich für einen entscheiden.", "Both black stones are in atari. Black has to choose one."),
    t("Suche eine gemeinsame Freiheit der beiden schwarzen Steine.", "Find a liberty shared by both black stones.")),
  task("challenge-capture", 7, [b(1, 0), b(1, 1), w(0, 0), w(2, 0), w(2, 1), w(1, 2)], "black", [p(0, 1)],
    t("Die schwarze Gruppe steht im Atari. Finde den Zug, der ihr zusätzliche Freiheiten gibt.", "The black group is in atari. Find the move that gives it more liberties."),
    t("Schwarz schlägt den weißen Eckstein. Der frei gewordene Eckpunkt gibt Schwarz wieder Luft.", "Black captures the white corner stone. The newly empty corner point gives Black breathing room."),
    t("Prüfe die Freiheit, die Schwarz mit dem weißen Eckstein teilt.", "Check the liberty Black shares with the white corner stone.")),
];

export const STAGE_FOUR: readonly LearnLesson[] = [
  {
    id: "s4-double-atari", stage: 4, title: t("Double Atari", "Double atari"), minutes: 3, steps: [
      double,
      {
        ...double, id: "diagonal-0-diagonal-groups", stones: [w(1, 1), w(2, 2), b(1, 0), b(1, 2), b(2, 3)], targets: [p(2, 1)],
        body: t("Die weißen Steine stehen diagonal zueinander. Welcher freie Punkt bringt trotzdem beide ins Atari?", "The white stones are diagonal to each other. Which empty point still puts both in atari?"),
      },
    ],
  },
  { id: "s4-ladder", stage: 4, title: t("Leiter", "Ladder"), minutes: 5, steps: ladderSteps() },
  {
    id: "s4-ladder-breaker", stage: 4, title: t("Eine Leiter brechen", "Ladder breaker"), minutes: 2, steps: [
      { ...ladderSteps(true)[2], continuePosition: false },
      mark("support", 7, [w(1, 1), b(0, 1), b(1, 0), b(2, 0), w(4, 2)], [p(4, 2)], t("Welche weiße Unterstützung liegt auf dem Weg der Leiter?", "Which supporting white stone lies in the ladder's path?"), t("Dieser Stein gibt Weiß beim Verbinden zusätzliche Freiheiten. Prüfe solche Steine vor dem Verfolgen.", "Connecting to this stone gives White extra liberties. Check for such stones before chasing."), "stone"),
    ],
  },
  {
    id: "s4-net", stage: 4, title: t("Netz / Geta", "Net / geta"), minutes: 4, steps: [
      info("net-term", 5, NET, t("Ein Netz schließt Fluchtwege mit Abstand ein. Setze die Umfassung und stoppe danach die Fluchtversuche von Weiß.", "A net encloses escape routes from a distance. Set the enclosure, then stop White's escape attempts.")),
      ...NET_PRACTICE,
    ],
  },
  {
    id: "s4-snapback", stage: 4, title: t("Snapback", "Snapback"), minutes: 3, steps: [
      info("snapback-term", 5, SNAPBACK, t("Beim Snapback opferst du einen Stein und schlägst danach eine größere Gruppe zurück. Prüfe nach dem gegnerischen Schlag ihre letzte Freiheit.", "In snapback, you sacrifice one stone and then recapture a larger group. After the opponent captures, check that group's last liberty.")),
      ...SNAPBACK_PRACTICE,
    ],
  },
  {
    id: "s4-throw-in", stage: 4, title: t("Einwerfen", "Throw-in"), minutes: 3, steps: [
      info("purpose", 7, eye, t("Ein Einwurf besetzt einen empfindlichen Punkt innerhalb einer gegnerischen Form. Hier greifst du den Raum an, den Schwarz für zwei Augen braucht.", "A throw-in occupies a vulnerable point inside the opponent's shape. Here it targets the space Black needs to make two eyes.")),
      ...throwIn,
    ],
  },
  {
    id: "s4-shortage", stage: 4, title: t("Eine Freiheit zu wenig", "Shortage of liberties"), minutes: 3, steps: [
      mark("count", 5, sharedCorner, [p(1, 0)], t("Die beiden schwarzen Steine sind getrennt, teilen aber ihre letzte Freiheit. Markiere sie.", "The black stones are separate but share their last liberty. Mark it."), t("Dieser eine Punkt hält beide Steine auf dem Brett.", "This single point keeps both stones on the board.")),
      {
        id: "cannot-connect", kind: "illegal", size: 5, stones: sharedCorner, toPlay: "black", targets: [p(1, 0)], expectedError: "suicide",
        body: t("Versuche, die schwarzen Steine über ihre gemeinsame Freiheit zu verbinden.", "Try to connect the black stones through their shared liberty."),
        success: t("Die verbundene Gruppe hätte keine Freiheit und würde nichts schlagen. Die Verbindung ist daher verboten.", "The connected group would have no liberties and would capture nothing, so the connection is illegal."),
      },
      info("after-capture", 5, [...sharedCorner.filter((stone) => stone.color === "white"), w(1, 0)],
        t("Weiß kann dort legal setzen, weil es damit beide schwarzen Steine schlägt. Die leeren Punkte zeigen, wo sie standen.", "White can play there legally because it captures both black stones. The empty points show where they stood.")),
    ],
  },
  { id: "s4-semeai", stage: 4, title: t("Schlagrennen / Semeai", "Capturing race / semeai"), minutes: 4, steps: [
    mark("black-liberties", 5, RACE, [p(0, 0), p(1, 0), p(0, 2), p(1, 2)], t("Die schwarze Zweiergruppe links kämpft gegen die weiße Zweiergruppe. Markiere Schwarz' Freiheiten.", "The black pair on the left races against the white pair. Mark Black's liberties."), t("Schwarz: vier Freiheiten.", "Black: four liberties.")),
    mark("white-liberties", 5, RACE, [p(2, 0), p(2, 2), p(3, 2)], t("Markiere jetzt die Freiheiten der weißen Zweiergruppe.", "Now mark the white pair's liberties."), t("Weiß: drei Freiheiten. Schwarz beginnt und kann zuerst schlagen.", "White: three liberties. Black moves first and can capture first.")),
    ...race,
    mark("shared", 5, [b(1, 1), w(2, 2)], [p(2, 1), p(1, 2)], t("Hier sind zwei Freiheiten gemeinsam: Sie grenzen direkt an beide Farben. Markiere nur diese.", "Here two liberties are shared: they touch both colors directly. Mark only those."), t("Eine gemeinsame Freiheit gehört beiden Gruppen. Ihr Besetzen nimmt auch der eigenen Gruppe eine Freiheit.", "A shared liberty belongs to both groups. Filling it also takes a liberty from your own group.")),
  ] },

  { id: "s4-sacrifice", stage: 4, title: t("Ein Stein als Opfer", "Sacrifice"), minutes: 3, steps: sacrifice },
  {
    id: "s4-tesuji", stage: 4, title: t("Was heißt Tesuji?", "What is a tesuji?"), minutes: 3, steps: [
      task("rescue-and-atari", 5, [b(2, 0), w(3, 0), w(1, 1), w(2, 1), b(1, 2), b(2, 2), b(3, 1)], "black", [p(1, 0)],
        t("Der schwarze Stein am oberen Rand steht im Atari. Rette ihn und bringe gleichzeitig die weiße Zweiergruppe ins Atari.", "The black stone at the top is in atari. Save it and put the white pair in atari in the process."),
        t("Die schwarze Gruppe entkommt und Weiß hat nur noch eine Freiheit. Ein wirkungsvoller lokaler Zug wie dieser heißt Tesuji.", "The black group escapes and White has only one liberty left. An effective local move like this is called a tesuji."),
        t("Prüfe am Rand die letzte Freiheit deines Steins.", "Check your stone's last liberty on the edge.")),
    ],
  },
  { id: "s4-mix", stage: 4, title: t("Taktik-Mix", "Tactics mix"), minutes: 4, steps: mixed },
  { id: "s4-challenge", stage: 4, title: t("Taktik-Challenge", "Tactics challenge"), minutes: 4, challenge: true, steps: challenge },
];
