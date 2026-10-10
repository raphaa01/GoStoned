import type { BoardSize, Position, Stone } from "@/lib/game/types";
import { LATER_STAGES } from "./laterCurriculum";
import { stableLessonColor } from "./lessonFlow";
import type { LearnLessonId } from "./progress";
import type { LearnStone } from "./lessonEngine";

export type LearnLocale = "de" | "en";
export type LocalizedLine = Readonly<{ de: string; en: string }>;

export type LessonStepKind =
  | "info"
  | "play"
  | "select"
  | "illegal"
  | "pass"
  | "capture-game"
  | "guided-game"
  | "beginner-game";

export type LessonStep = Readonly<{
  id: string;
  kind: LessonStepKind;
  body: LocalizedLine;
  task?: LocalizedLine;
  success?: LocalizedLine;
  wrong?: LocalizedLine;
  hint?: LocalizedLine;
  size?: number;
  stones?: readonly LearnStone[];
  toPlay?: Stone;
  targets?: readonly Position[];
  selectFrom?: "empty" | "stone" | "any";
  expectedError?: "suicide" | "ko";
  koPreviousBoard?: readonly LearnStone[];
  emphasis?: readonly Position[];
  territory?: readonly Position[];
  group?: readonly Position[];
  lastMove?: Position;
  continuePosition?: boolean;
  replies?: readonly (Position | null)[];
  replyExplanations?: readonly LocalizedLine[];
  selectionCount?: number;
  hintArea?: readonly Position[];
  gameSize?: BoardSize;
  requireWin?: boolean;
  links?: readonly ("play" | "puzzles" | "review")[];
}>;

export type LearnLesson = Readonly<{
  id: LearnLessonId;
  stage: LearnStageId;
  title: LocalizedLine;
  minutes: number;
  challenge?: boolean;
  steps: readonly LessonStep[];
}>;

export type LearnStageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type LearnStage = Readonly<{
  id: LearnStageId;
  title: LocalizedLine;
  lessons: readonly LearnLesson[];
}>;

const t = (de: string, en: string): LocalizedLine => ({ de, en });
const p = (x: number, y: number): Position => ({ x, y });
const b = (x: number, y: number): LearnStone => ({ x, y, color: "black" });
const w = (x: number, y: number): LearnStone => ({ x, y, color: "white" });

const EYE_WALL = [
  ...[1, 2, 3, 4, 5].map((x) => b(x, 2)),
  b(1, 3), b(5, 3),
  ...[1, 2, 3, 4, 5].map((x) => b(x, 4)),
];
const OUTSIDE_WHITE = [
  ...[0, 1, 2, 3, 4, 5, 6].flatMap((x) => [w(x, 1), w(x, 5)]),
  ...[2, 3, 4].flatMap((y) => [w(0, y), w(6, y)]),
];
const THREE_POINT_EYE = [...EYE_WALL, ...OUTSIDE_WHITE];
const TWO_EYE_SHAPE = [...THREE_POINT_EYE, b(3, 3)];
const SEKI = Array.from({ length: 5 }, (_, y) => Array.from({ length: 5 }, (_, x) =>
  x === 2 && (y === 1 || y === 3) ? null : (x < 2 || (x === 2 && y < 4) ? b(x, y) : w(x, y)),
)).flat().filter((stone): stone is LearnStone => stone !== null);

const CLOSED_BLACK = [b(0, 1), b(1, 0), b(2, 1), b(1, 2)] as const;

const STAGE_ONE: readonly LearnLesson[] = [
  {
    id: "s1-board", stage: 1, minutes: 2, title: t("Das Go-Brett", "The Go board"), steps: [
      { id: "intersections", kind: "info", size: 5, stones: [], emphasis: [p(2, 2)], body: t("Go wird auf den Schnittpunkten gespielt – dort, wo sich zwei Linien kreuzen.", "Go is played on intersections—where two lines cross.") },
      { id: "first-stone", kind: "play", size: 5, stones: [], toPlay: "black", body: t("Tippe auf einen freien Schnittpunkt.", "Tap any empty intersection."), task: t("Setze einen schwarzen Stein.", "Place a black stone."), success: t("Der Stein liegt auf den Linien, nicht in einem Feld.", "The stone sits on the lines, not inside a square."), wrong: t("Dieser Schnittpunkt ist nicht frei.", "That intersection is not empty.") },
      { id: "stones-stay", kind: "play", size: 5, continuePosition: true, stones: [], toPlay: "black", body: t("Steine bewegen sich nach dem Setzen nicht mehr.", "Stones do not move after they are placed."), task: t("Setze einen zweiten Stein.", "Place a second stone."), success: t("Beide Steine bleiben auf ihren Schnittpunkten.", "Both stones stay on their intersections.") },
      { id: "third-stone", kind: "play", size: 5, continuePosition: true, stones: [], toPlay: "black", body: t("Ein Stein verlässt das Brett nur, wenn er geschlagen wird.", "A stone leaves the board only when it is captured."), task: t("Setze noch einen Stein.", "Place one more stone."), success: t("Genau. Setzen, liegen lassen – später lernst du das Schlagen.", "Right. Place it and leave it—capturing comes later.") },
    ],
  },
  {
    id: "s1-turns", stage: 1, minutes: 2, title: t("Abwechselnde Züge", "Taking turns"), steps: [
      { id: "order", kind: "info", size: 5, stones: [b(1, 1), w(3, 1), b(2, 3)], lastMove: p(2, 3), body: t("Schwarz beginnt. Danach setzen Schwarz und Weiß immer abwechselnd.", "Black begins. After that, Black and White alternate." ) },
      { id: "black-turn", kind: "play", size: 5, stones: [], toPlay: "black", targets: [p(1, 2)], emphasis: [p(1, 2)], replies: [p(3, 2)], body: t("Du spielst Schwarz. Weiß antwortet nach deinem Zug.", "You play Black. White replies after your move."), task: t("Setze Schwarz auf den markierten Punkt.", "Place Black on the marked point."), success: t("Weiß hat geantwortet. Jetzt bist du wieder mit Schwarz am Zug.", "White has replied. Now it is your turn as Black again."), wrong: t("Nutze den markierten Schnittpunkt.", "Use the marked intersection.") },
      { id: "black-again", kind: "play", size: 5, continuePosition: true, stones: [b(1, 2), w(3, 2)], toPlay: "black", targets: [p(2, 3)], emphasis: [p(2, 3)], body: t("Nach dem weißen Stein folgt wieder Schwarz.", "After the white stone, Black moves again."), task: t("Setze deinen nächsten schwarzen Stein.", "Place your next black stone."), success: t("Schwarz, Weiß, Schwarz: Beide Spieler setzen abwechselnd; jeder behält seine Farbe.", "Black, White, Black: the players alternate; each keeps their color."), wrong: t("Setze Schwarz auf den markierten Punkt.", "Place Black on the marked point.") },
    ],
  },
  {
    id: "s1-liberties", stage: 1, minutes: 4, title: t("Freiheiten", "Liberties"), steps: [
      { id: "center", kind: "select", size: 5, stones: [b(2, 2)], targets: [p(2, 1), p(1, 2), p(3, 2), p(2, 3)], selectFrom: "empty", body: t("Jeder freie Nachbar direkt oben, unten, links oder rechts ist eine Freiheit.", "Every empty neighbor directly above, below, left, or right is a liberty."), task: t("Tippe auf alle Freiheiten des schwarzen Steins.", "Tap every liberty of the black stone."), success: t("Genau. Dieser Stein hat vier Freiheiten.", "Exactly. This stone has four liberties."), wrong: t("Diagonal zählt nicht. Nur direkte Nachbarn entlang einer Linie zählen.", "Diagonals do not count. Only direct neighbors along a line count."), hint: t("Folge den vier Linien vom Stein nach außen.", "Follow the four lines leading away from the stone.") },
      { id: "edge", kind: "select", size: 5, stones: [b(0, 2)], targets: [p(0, 1), p(1, 2), p(0, 3)], selectFrom: "empty", body: t("Am Rand fehlt ein Nachbar.", "One neighbor is missing at the edge."), task: t("Markiere die Freiheiten.", "Mark the liberties."), success: t("Richtig: drei Freiheiten.", "Right: three liberties."), wrong: t("Außerhalb des Brettes gibt es keine Freiheit.", "There is no liberty beyond the board.") },
      { id: "corner", kind: "select", size: 5, stones: [b(0, 0)], targets: [p(1, 0), p(0, 1)], selectFrom: "empty", body: t("In der Ecke fehlen zwei Nachbarn.", "Two neighbors are missing in a corner."), task: t("Markiere beide Freiheiten.", "Mark both liberties."), success: t("Ein einzelner Eckstein hat zwei Freiheiten.", "A lone corner stone has two liberties."), wrong: t("Die Diagonale ist keine Freiheit.", "The diagonal is not a liberty.") },
      { id: "shared", kind: "select", size: 5, stones: [b(2, 2), b(3, 2)], targets: [p(2, 1), p(1, 2), p(2, 3), p(3, 1), p(4, 2), p(3, 3)], selectFrom: "empty", body: t("Direkt verbundene Steine teilen ihre Freiheiten.", "Directly connected stones share their liberties."), task: t("Markiere die Freiheiten der ganzen Gruppe.", "Mark the liberties of the whole group."), success: t("Die Zweiergruppe hat sechs gemeinsame Freiheiten.", "The two-stone group has six shared liberties."), wrong: t("Zähle nur freie Punkte direkt neben einem der beiden Steine.", "Count only empty points directly next to either stone.") },
    ],
  },
  {
    id: "s1-groups", stage: 1, minutes: 3, title: t("Gruppen", "Groups"), steps: [
      { id: "connected", kind: "info", size: 5, stones: [b(1, 2), b(2, 2)], group: [p(1, 2), p(2, 2)], body: t("Gleichfarbige Steine, die sich direkt berühren, bilden eine Gruppe. Sie werden gemeinsam geschlagen.", "Same-color stones touching directly form a group. They are captured together.") },
      { id: "diagonal", kind: "info", size: 5, stones: [b(1, 1), b(2, 2)], body: t("Diese Steine berühren sich nur diagonal. Sie sind zwei getrennte Gruppen.", "These stones touch only diagonally. They are two separate groups.") },
      { id: "find-group", kind: "select", size: 5, stones: [b(1, 2), b(2, 2), b(3, 3)], targets: [p(1, 2), p(2, 2)], selectFrom: "stone", body: t("Zwei der drei Steine bilden eine Gruppe.", "Two of the three stones form a group."), task: t("Tippe auf beide verbundenen Steine.", "Tap both connected stones."), success: t("Richtig. Der diagonale Stein gehört nicht dazu.", "Right. The diagonal stone is not part of that group."), wrong: t("Prüfe, welche Steine sich entlang einer Linie berühren.", "Check which stones touch along a line.") },
    ],
  },
  {
    id: "s1-capture", stage: 1, minutes: 4, title: t("Schlagen", "Capturing"), steps: [
      { id: "single", kind: "play", size: 5, stones: [w(2, 2), b(2, 1), b(1, 2), b(3, 2)], toPlay: "black", targets: [p(2, 3)], emphasis: [p(2, 3)], body: t("Weiß hat nur noch eine Freiheit.", "White has only one liberty left."), task: t("Nimm die letzte Freiheit.", "Take the last liberty."), success: t("Der weiße Stein hat keine Freiheit mehr und wird entfernt.", "The white stone has no liberties and is removed."), wrong: t("Die letzte Freiheit liegt direkt unter Weiß.", "The last liberty is directly below White.") },
      { id: "edge", kind: "play", size: 5, stones: [w(0, 2), b(0, 1), b(1, 2)], toPlay: "black", targets: [p(0, 3)], body: t("Am Rand braucht Schwarz weniger Steine zum Umschließen.", "At the edge, Black needs fewer stones to surround White."), task: t("Schlage den weißen Randstein.", "Capture the white edge stone."), success: t("Geschlagen. Der Brettrand gibt keine Freiheit.", "Captured. The board edge provides no liberty."), wrong: t("Fülle den freien Punkt direkt unter Weiß.", "Fill the empty point directly below White.") },
      { id: "group", kind: "play", size: 5, stones: [w(2, 2), w(3, 2), b(2, 1), b(3, 1), b(1, 2), b(4, 2), b(2, 3)], toPlay: "black", targets: [p(3, 3)], body: t("Die beiden weißen Steine sind eine Gruppe und haben gemeinsam noch eine Freiheit.", "The two white stones are one group with one shared liberty left."), task: t("Schlage die ganze Gruppe.", "Capture the whole group."), success: t("Beide Steine verschwinden zusammen.", "Both stones disappear together."), wrong: t("Zähle die Freiheiten der Gruppe, nicht jedes Steins einzeln.", "Count the liberties of the group, not each stone separately.") },
    ],
  },
  {
    id: "s1-atari", stage: 1, minutes: 3, title: t("Atari", "Atari"), steps: [
      { id: "meaning", kind: "info", size: 5, stones: [b(2, 2), w(2, 1), w(1, 2), w(3, 2)], emphasis: [p(2, 3)], body: t("Diese schwarze Gruppe hat nur noch eine Freiheit. Das nennt man Atari.", "This black group has only one liberty left. This is called atari.") },
      { id: "make-atari", kind: "play", size: 5, stones: [b(2, 2), w(2, 1), w(1, 2)], toPlay: "white", targets: [p(3, 2), p(2, 3)], body: t("Schwarz hat noch zwei Freiheiten.", "Black has two liberties left."), task: t("Setze Weiß so, dass Schwarz nur eine behält.", "Play White so Black keeps only one."), success: t("Schwarz steht jetzt im Atari: Eine Freiheit bleibt.", "Black is now in atari: one liberty remains."), wrong: t("Nimm die Freiheit rechts vom schwarzen Stein.", "Take the liberty to the right of the black stone.") },
      { id: "group-atari", kind: "play", size: 5, stones: [b(2, 2), b(2, 3), w(1, 2), w(1, 3), w(2, 1), w(3, 3)], toPlay: "white", targets: [p(3, 2), p(2, 4)], body: t("Auch eine Gruppe steht im Atari, wenn ihr gemeinsam nur eine Freiheit bleibt.", "A group is also in atari when it has only one shared liberty."), task: t("Setze die Zweiergruppe ins Atari.", "Put the two-stone group in atari."), success: t("Richtig. Der ganzen Gruppe bleibt eine Freiheit.", "Right. The whole group has one liberty left."), wrong: t("Nimm die Freiheit rechts vom oberen schwarzen Stein.", "Take the liberty to the right of the upper black stone.") },
    ],
  },
  {
    id: "s1-escape", stage: 1, minutes: 4, title: t("Aus Atari entkommen", "Escaping atari"), steps: [
      { id: "extend", kind: "play", size: 5, stones: [b(2, 2), w(2, 1), w(1, 2), w(3, 2)], toPlay: "black", targets: [p(2, 3)], body: t("Schwarz steht im Atari.", "Black is in atari."), task: t("Erweitere auf die letzte Freiheit.", "Extend onto the last liberty."), success: t("Die verbundene Gruppe hat jetzt drei Freiheiten.", "The connected group now has three liberties."), wrong: t("Spiele auf die einzige Freiheit unter dem Stein.", "Play on the only liberty below the stone.") },
      { id: "connect", kind: "play", size: 5, stones: [b(1, 2), b(3, 2), w(1, 1), w(0, 2), w(1, 3)], toPlay: "black", targets: [p(2, 2)], body: t("Der linke schwarze Stein steht im Atari. Rechts wartet eine sichere Gruppe.", "The left black stone is in atari. A safer group is waiting on the right."), task: t("Verbinde beide Gruppen.", "Connect the two groups."), success: t("Verbunden. Die Steine teilen jetzt ihre Freiheiten.", "Connected. The stones now share their liberties."), wrong: t("Setze in die Lücke zwischen den schwarzen Steinen.", "Play in the gap between the black stones.") },
      { id: "capture-attacker", kind: "play", size: 5, stones: [b(1, 1), b(3, 1), b(2, 2), w(2, 1), w(1, 2), w(3, 2)], toPlay: "black", targets: [p(2, 0)], body: t("Der mittlere schwarze Stein steht im Atari. Der obere Angreifer hat selbst nur eine Freiheit.", "The middle black stone is in atari. The upper attacker also has only one liberty."), task: t("Schlage den Angreifer.", "Capture the attacker."), success: t("Der Schlag öffnet eine neue Freiheit für Schwarz.", "The capture opens a new liberty for Black."), wrong: t("Nimm die letzte Freiheit des weißen Steins oben.", "Take the upper white stone's last liberty.") },
    ],
  },
  {
    id: "s1-review", stage: 1, minutes: 3, title: t("Gemischter Check", "Mixed check"), steps: [
      { id: "liberties", kind: "select", size: 5, stones: [b(0, 0)], targets: [p(1, 0), p(0, 1)], selectFrom: "empty", body: t("Ein Eckstein hat weniger Nachbarn.", "A corner stone has fewer neighbors."), task: t("Markiere seine Freiheiten.", "Mark its liberties."), success: t("Zwei Freiheiten.", "Two liberties."), wrong: t("Nur direkte Nachbarn zählen.", "Only direct neighbors count.") },
      { id: "atari", kind: "play", size: 5, stones: [b(2, 2), w(2, 1), w(1, 2)], toPlay: "white", targets: [p(3, 2), p(2, 3)], body: t("Schwarz hat zwei Freiheiten.", "Black has two liberties."), task: t("Setze Schwarz ins Atari.", "Put Black in atari."), success: t("Nur eine Freiheit bleibt.", "Only one liberty remains."), wrong: t("Besetze eine der zwei Freiheiten neben Schwarz.", "Take either of Black's two liberties.") },
      { id: "capture", kind: "play", size: 5, stones: [w(0, 2), b(0, 1), b(1, 2)], toPlay: "black", targets: [p(0, 3)], body: t("Weiß hat eine Freiheit.", "White has one liberty."), task: t("Schlage Weiß.", "Capture White."), success: t("Der Randstein wird entfernt.", "The edge stone is removed."), wrong: t("Fülle die letzte Freiheit.", "Fill the last liberty.") },
      { id: "group", kind: "select", size: 5, stones: [b(1, 2), b(2, 2), b(3, 3)], targets: [p(1, 2), p(2, 2)], selectFrom: "stone", body: t("Diagonal verbindet nicht.", "Diagonals do not connect."), task: t("Markiere die verbundene Gruppe.", "Mark the connected group."), success: t("Diese zwei Steine teilen ihre Freiheiten; der dritte ist eine eigene Gruppe.", "These two stones share their liberties; the third is a separate group."), wrong: t("Wähle nur Steine, die sich direkt berühren.", "Choose only stones that touch directly.") },
    ],
  },
  {
    id: "s1-capture-go", stage: 1, minutes: 5, challenge: true, title: t("Capture Challenge", "Capture challenge"), steps: [
      { id: "game", kind: "capture-game", body: t("Wer zuerst einen gegnerischen Stein oder eine Gruppe schlägt, gewinnt.", "The first player to capture an opposing stone or group wins."), task: t("Du spielst Schwarz. Schlage zuerst.", "You are Black. Capture first.") },
    ],
  },
] as const;

const STAGE_TWO: readonly LearnLesson[] = [
  {
    id: "s2-goal", stage: 2, minutes: 3, title: t("Worum geht es?", "What is the goal?"), steps: [
      { id: "black-area", kind: "select", size: 9, stones: [b(0, 2), b(1, 2), b(2, 2), b(2, 1), b(2, 0), w(6, 8), w(6, 7), w(6, 6), w(7, 6), w(8, 6)], targets: [p(0, 0), p(1, 0), p(0, 1), p(1, 1)], territory: [p(0, 0), p(1, 0), p(0, 1), p(1, 1)], selectFrom: "empty", body: t("Schwarz umschließt links oben vier freie Schnittpunkte.", "Black encloses four empty intersections in the upper left."), task: t("Tippe auf das schwarze Gebiet.", "Tap Black's territory."), success: t("Diese vier Punkte zählen am Ende für Schwarz.", "These four points count for Black at the end."), wrong: t("Gebiet muss durch Steine und den Brettrand vollständig begrenzt sein.", "Territory must be completely bounded by stones and the board edge.") },
      { id: "white-area", kind: "select", size: 9, stones: [b(0, 2), b(1, 2), b(2, 2), b(2, 1), b(2, 0), w(6, 8), w(6, 7), w(6, 6), w(7, 6), w(8, 6)], targets: [p(7, 7), p(8, 7), p(7, 8), p(8, 8)], selectFrom: "empty", body: t("Weiß kontrolliert den geschlossenen Bereich unten rechts. Im normalen Go sammelst du Gebiet, nicht nur geschlagene Steine.", "White controls the enclosed lower-right region. In normal Go you collect territory, not just captured stones."), task: t("Markiere die vier weißen Gebietspunkte.", "Mark White's four territory points."), success: t("Wer am Ende mehr Punkte hat, gewinnt. Gleich lernst du, wie gezählt wird.", "Whoever has more points at the end wins. Next you will learn how to count."), wrong: t("Suche den geschlossenen Bereich zwischen Weiß und Brettrand.", "Find the enclosed area between White and the board edge.") },
    ],
  },
  {
    id: "s2-territory", stage: 2, minutes: 4, title: t("Was ist Gebiet?", "What is territory?"), steps: [
      { id: "closed", kind: "select", size: 5, stones: CLOSED_BLACK, targets: [p(1, 1)], territory: [p(1, 1)], selectFrom: "empty", body: t("Dieser freie Punkt ist auf allen Seiten von Schwarz begrenzt.", "This empty point is bounded by Black on every side."), task: t("Markiere das schwarze Gebiet.", "Mark Black's territory."), success: t("Vollständig umschlossen: schwarzes Gebiet.", "Completely enclosed: Black territory."), wrong: t("Suche den vollständig umschlossenen Punkt.", "Find the completely enclosed point.") },
      { id: "open", kind: "select", size: 5, stones: [b(0, 1), b(1, 0), b(2, 1)], targets: [p(1, 2)], emphasis: [p(1, 1), p(1, 2)], selectFrom: "empty", body: t("Oben wirkt die Form geschlossen, aber unten ist sie offen.", "The shape looks closed above, but it is open below."), task: t("Tippe auf die Öffnung – dadurch ist der Innenpunkt noch kein Gebiet.", "Tap the opening—the inner point is not territory yet."), success: t("Richtig. Solange die Grenze offen ist, gehört der Bereich niemandem.", "Right. While the boundary is open, the area belongs to neither player."), wrong: t("Der Innenpunkt ist noch nicht Gebiet. Suche die Lücke in der Grenze.", "The inner point is not territory yet. Find the gap in the boundary.") },
      { id: "enemy-inside", kind: "select", size: 5, stones: [b(0, 1), b(1, 0), b(2, 1), b(0, 2), b(2, 2), b(1, 3), w(1, 1)], targets: [p(1, 1)], selectFrom: "stone", body: t("Ein weißer Stein steht im umschlossenen Bereich.", "A white stone stands inside the enclosed area."), task: t("Tippe auf den Stein, der zuerst als tot vereinbart oder geschlagen werden muss.", "Tap the stone that must first be agreed dead or captured."), success: t("Solange Weiß dort lebt, ist der Punkt kein schwarzes Gebiet.", "While White lives there, the point is not Black territory."), wrong: t("Der weiße Stein verhindert die Wertung als leeren Gebietspunkt.", "The white stone prevents the point from being scored as empty territory.") },
      { id: "edge-wall", kind: "select", size: 5, stones: [b(0, 2), b(1, 2), b(2, 2), b(2, 1), b(2, 0)], targets: [p(0, 0), p(1, 0), p(0, 1), p(1, 1)], territory: [p(0, 0), p(1, 0), p(0, 1), p(1, 1)], selectFrom: "empty", body: t("Der Brettrand kann Teil der Grenze sein.", "The board edge can be part of the boundary."), task: t("Markiere das Gebiet in der Ecke.", "Mark the corner territory."), success: t("Vier Punkte. Außerhalb des Brettes braucht Schwarz keine Steine.", "Four points. Black needs no stones beyond the board."), wrong: t("Wähle nur die vier Punkte zwischen schwarzen Steinen und Brettrand.", "Choose only the four points between Black's stones and the board edge.") },
    ],
  },
  {
    id: "s2-suicide", stage: 2, minutes: 3, title: t("Selbstmord", "Suicide"), steps: [
      { id: "illegal", kind: "illegal", size: 5, stones: [w(2, 1), w(1, 2), w(3, 2), w(2, 3)], toPlay: "black", targets: [p(2, 2)], expectedError: "suicide", body: t("Der mittlere Punkt ist vollständig von Weiß umgeben.", "The center point is completely surrounded by White."), task: t("Versuche, Schwarz in die Mitte zu setzen.", "Try to place Black in the center."), success: t("Nicht erlaubt: Der neue Stein hätte sofort keine Freiheit.", "Not allowed: the new stone would have no liberty immediately."), wrong: t("Versuche den umschlossenen Mittelpunkt.", "Try the surrounded center point.") },
      { id: "capture-exception", kind: "play", size: 5, stones: [w(2, 1), w(1, 2), w(3, 2), w(2, 3), b(2, 0), b(1, 1), b(3, 1), b(0, 2), b(4, 2), b(1, 3), b(3, 3), b(2, 4)], toPlay: "black", targets: [p(2, 2)], body: t("Diesmal haben die vier weißen Steine jeweils nur die Mitte als letzte Freiheit.", "This time, each of the four white stones has the center as its last liberty."), task: t("Spiele wieder in die Mitte.", "Play in the center again."), success: t("Erlaubt: Schwarz schlägt zuerst die weißen Steine und erhält dadurch Freiheiten.", "Allowed: Black captures the white stones first and gains liberties."), wrong: t("Spiele auf den Mittelpunkt.", "Play on the center point.") },
    ],
  },
  {
    id: "s2-ko", stage: 2, minutes: 4, title: t("Ko", "Ko"), steps: [
      { id: "capture", kind: "info", size: 5, stones: [b(2, 3), w(1, 3), w(3, 3), w(2, 4), b(2, 1), b(1, 2), b(3, 2)], lastMove: p(2, 3), body: t("Schwarz hat gerade den weißen Stein in der Mitte geschlagen. Der markierte schwarze Stein hat selbst nur eine Freiheit. Du spielst in dieser Aufgabe Weiß.", "Black just captured the white stone in the center. The marked black stone itself has only one liberty. You play White in this exercise.") },
      { id: "blocked-recapture", kind: "illegal", size: 5, stones: [b(2, 3), w(1, 3), w(3, 3), w(2, 4), b(2, 1), b(1, 2), b(3, 2)], koPreviousBoard: [w(2, 2), w(1, 3), w(3, 3), w(2, 4), b(2, 1), b(1, 2), b(3, 2)], toPlay: "white", targets: [p(2, 2)], expectedError: "ko", body: t("Ein sofortiger Rückschlag würde genau die vorige Stellung wiederholen.", "An immediate recapture would repeat the previous position exactly."), task: t("Versuche, sofort zurückzuschlagen.", "Try to recapture immediately."), success: t("Die Ko-Regel blockiert den Zug. Weiß muss zuerst woanders spielen.", "The ko rule blocks the move. White must play elsewhere first."), wrong: t("Versuche den Rückschlag auf dem gerade frei gewordenen Punkt.", "Try the recapture on the point that just became empty.") },
      { id: "elsewhere", kind: "play", size: 5, stones: [b(2, 3), w(1, 3), w(3, 3), w(2, 4), b(2, 1), b(1, 2), b(3, 2)], toPlay: "white", targets: [p(0, 4)], emphasis: [p(0, 4)], replies: [p(4, 0)], body: t("Weiß spielt zuerst an einer anderen Stelle. Schwarz antwortet woanders.", "White first plays somewhere else. Black replies elsewhere."), task: t("Setze Weiß auf den markierten Punkt.", "Play White on the marked point."), success: t("Die letzte Stellung ist jetzt eine andere. Der Rückschlag ist wieder erlaubt.", "The preceding position is now different. Recapturing is allowed again.") },
      { id: "later-recapture", kind: "play", size: 5, continuePosition: true, stones: [b(2, 3), w(1, 3), w(3, 3), w(2, 4), b(2, 1), b(1, 2), b(3, 2), w(0, 4), b(4, 0)], toPlay: "white", targets: [p(2, 2)], body: t("Weiß und Schwarz haben inzwischen je einen Zug woanders gespielt.", "White and Black have each played elsewhere in the meantime."), task: t("Jetzt darf Weiß zurückschlagen.", "Now White may recapture."), success: t("Nach einem Zwischenzug ist der Rückschlag erlaubt.", "After an intervening move, the recapture is allowed."), wrong: t("Schlage den schwarzen Ko-Stein zurück.", "Recapture the black ko stone.") },
    ],
  },
  {
    id: "s2-pass", stage: 2, minutes: 2, title: t("Passen", "Passing"), steps: [
      { id: "pass", kind: "pass", size: 9, stones: [b(0, 2), b(1, 2), b(2, 2), b(2, 1), b(2, 0), w(6, 8), w(6, 7), w(6, 6), w(7, 6), w(8, 6)], body: t("Du musst keinen Stein setzen. Wenn dein Zug nichts mehr verbessert, kannst du passen.", "You do not have to place a stone. If no move improves your position, you may pass."), task: t("Passe einmal.", "Pass once."), success: t("Nach einem Pass ist der Gegner am Zug.", "After a pass, it is the opponent's turn.") },
      { id: "two-passes", kind: "info", size: 9, stones: [b(0, 2), b(1, 2), b(2, 2), b(2, 1), b(2, 0), w(6, 8), w(6, 7), w(6, 6), w(7, 6), w(8, 6)], body: t("Wenn beide Spieler direkt nacheinander passen, endet die Partie.", "When both players pass consecutively, the game ends." ) },
    ],
  },
  {
    id: "s2-dead", stage: 2, minutes: 3, title: t("Tote Steine", "Dead stones"), steps: [
      { id: "mark-dead", kind: "select", size: 5, stones: [b(1, 0), b(1, 1), b(1, 2), b(0, 2), w(0, 0)], targets: [p(0, 0)], selectFrom: "stone", body: t("Der weiße Eckstein hat eine Freiheit. Selbst dort bekäme er keine neue Freiheit: Er kann nicht entkommen.", "The white corner stone has one liberty. Extending there would give it no new liberty: it cannot escape."), task: t("Markiere den toten Stein.", "Mark the dead stone."), success: t("Am Spielende wird ein vereinbarter toter Stein entfernt und als Gefangener gezählt.", "At the end, an agreed dead stone is removed and counted as a prisoner."), wrong: t("Suche den weißen Stein in der Ecke.", "Find the white stone in the corner.") },
    ],
  },
  {
    id: "s2-ending", stage: 2, minutes: 2, title: t("Spielende", "Ending the game"), steps: [
      { id: "last-gap", kind: "play", size: 5, stones: [b(0, 2), b(1, 2), b(2, 2), b(2, 1), w(4, 2), w(3, 2), w(2, 3), w(3, 3), w(4, 3), w(2, 4)], toPlay: "black", targets: [p(2, 0)], body: t("Oben links ist die schwarze Grenze noch offen.", "Black's upper-left boundary is still open."), task: t("Schließe zuerst die letzte sinnvolle Lücke.", "Close the last useful gap first."), success: t("Jetzt sind die Grenzen klar. Weitere Züge im eigenen Gebiet würden nur Punkte kosten.", "Now the boundaries are clear. Further moves inside your own territory would only cost points."), wrong: t("Schließe die schwarze Grenze oben.", "Close Black's boundary at the top.") },
      { id: "end-pass", kind: "pass", size: 5, stones: [b(0, 2), b(1, 2), b(2, 2), b(2, 1), b(2, 0), w(4, 2), w(3, 2), w(2, 3), w(3, 3), w(4, 3), w(2, 4)], body: t("Alle Grenzen sind geschlossen.", "All boundaries are closed."), task: t("Passe. Nach dem Pass des Gegners endet die Partie.", "Pass. The game ends after the opponent also passes."), success: t("Zwei Pässe beenden die Partie; danach werden tote Steine und Punkte geprüft.", "Two passes end the game; dead stones and points are checked next.") },
    ],
  },
  {
    id: "s2-counting", stage: 2, minutes: 4, title: t("Punkte zählen", "Counting points"), steps: [
      { id: "black", kind: "select", size: 5, stones: [b(0, 2), b(1, 2), b(2, 2), b(2, 1), b(2, 0), w(4, 2), w(3, 2), w(2, 3), w(3, 3), w(4, 3), w(2, 4)], targets: [p(0, 0), p(1, 0), p(0, 1), p(1, 1)], territory: [p(0, 0), p(1, 0), p(0, 1), p(1, 1)], selectFrom: "empty", body: t("Zähle zuerst jeden freien Punkt im schwarzen Gebiet.", "First count every empty point in Black's territory."), task: t("Markiere Schwarz: vier Punkte.", "Mark Black's four points."), success: t("Schwarz hat vier Gebietspunkte.", "Black has four territory points."), wrong: t("Wähle nur den geschlossenen Bereich oben links.", "Choose only the enclosed upper-left area.") },
      { id: "white", kind: "select", size: 5, stones: [b(0, 2), b(1, 2), b(2, 2), b(2, 1), b(2, 0), w(4, 2), w(3, 2), w(2, 3), w(3, 3), w(4, 3), w(2, 4)], targets: [p(3, 4), p(4, 4)], territory: [p(3, 4), p(4, 4)], selectFrom: "empty", body: t("Das weiße Gebiet liegt unten rechts.", "White's territory is in the lower right."), task: t("Markiere die zwei weißen Punkte.", "Mark White's two points."), success: t("Weiß hat zwei Gebietspunkte. Gefangene und Komi werden danach addiert.", "White has two territory points. Prisoners and komi are added afterward."), wrong: t("Suche den freien Bereich zwischen Weiß und Brettrand.", "Find the empty area between White and the board edge.") },
      { id: "total", kind: "info", size: 5, stones: [b(0, 2), b(1, 2), b(2, 2), b(2, 1), b(2, 0), w(4, 2), w(3, 2), w(2, 3), w(3, 3), w(4, 3), w(2, 4)], territory: [p(0, 0), p(1, 0), p(0, 1), p(1, 1), p(3, 4), p(4, 4)], body: t("Schwarz: 4 Gebietspunkte. Weiß: 2. Jeder geschlagene oder als tot vereinbarte gegnerische Stein zählt zusätzlich 1 Punkt; Steine auf dem Brett zählen nicht.", "Black: 4 territory points. White: 2. Each captured or agreed-dead opposing stone adds 1 point; stones on the board do not count.") },
    ],
  },
  {
    id: "s2-komi", stage: 2, minutes: 1, title: t("Komi", "Komi"), steps: [
      { id: "komi", kind: "info", size: 9, stones: [b(4, 4)], body: t("Schwarz beginnt und hat dadurch einen kleinen Vorteil. Nach den GoStone-Regeln erhält Weiß deshalb 6,5 Punkte Komi.", "Black starts and gains a small advantage. Under GoStone's rules, White therefore receives 6.5 points of komi.") },
    ],
  },
  {
    id: "s2-first-game", stage: 2, minutes: 8, challenge: true, title: t("Deine erste 9×9-Partie", "Your first 9×9 game"), steps: [
      { id: "review-atari", kind: "play", size: 5, stones: [b(2, 2), w(2, 1), w(1, 2), w(3, 2)], toPlay: "black", targets: [p(2, 3)], body: t("Vor der Partie: Dieser schwarze Stein hat nur eine Freiheit.", "Before the game: this black stone has only one liberty."), task: t("Entkomme aus Atari.", "Escape atari."), success: t("Die Zweiergruppe hat jetzt drei Freiheiten.", "The two-stone group now has three liberties."), wrong: t("Verbinde einen neuen Stein auf der letzten Freiheit.", "Connect a new stone on the last liberty.") },
      { id: "review-ko", kind: "illegal", size: 5, stones: [b(2, 3), w(1, 3), w(3, 3), w(2, 4), b(2, 1), b(1, 2), b(3, 2)], koPreviousBoard: [w(2, 2), w(1, 3), w(3, 3), w(2, 4), b(2, 1), b(1, 2), b(3, 2)], toPlay: "white", targets: [p(2, 2)], expectedError: "ko", body: t("Schwarz hat gerade den weißen Stein geschlagen.", "Black has just captured the white stone."), task: t("Versuche den sofortigen Rückschlag.", "Try recapturing immediately."), success: t("Ko: Weiß muss erst woanders spielen. Diese Regel gilt auch in deiner Partie.", "Ko: White must play elsewhere first. This rule also applies in your game.") },
      { id: "game", kind: "guided-game", body: t("Du spielst Schwarz. Die App weist nur auf Atari und zu frühes Passen hin.", "You are Black. The app only points out atari and passing too early."), task: t("Spiele bis zu zwei Pässen, markiere tote Gruppen und zähle.", "Play until two passes, mark dead groups, and count." ) },
    ],
  },
] as const;

const STAGE_THREE: readonly LearnLesson[] = [
  {
    id: "s3-alive", stage: 3, minutes: 3, title: t("Was bedeutet lebendig?", "What does alive mean?"), steps: [
      { id: "safe", kind: "info", size: 7, stones: TWO_EYE_SHAPE, territory: [p(2, 3), p(4, 3)], body: t("Eine Gruppe ist lebendig, wenn der Gegner sie nicht mehr schlagen kann. Diese Gruppe besitzt zwei getrennte Innenräume.", "A group is alive when the opponent can no longer capture it. This group has two separate inner spaces." ) },
      { id: "try", kind: "illegal", size: 7, stones: TWO_EYE_SHAPE, toPlay: "white", targets: [p(2, 3), p(4, 3)], expectedError: "suicide", body: t("Weiß hat die Gruppe außen umschlossen. Nur die beiden Innenräume sind noch frei.", "White has surrounded the group outside. Only the two inner spaces remain empty."), task: t("Versuche, in einen Innenraum zu spielen.", "Try to play inside one inner space."), success: t("Der Zug ist Selbstmord, weil der andere Innenraum der schwarzen Gruppe noch frei bleibt.", "The move is suicide because the black group's other inner space remains free."), wrong: t("Versuche einen der beiden Innenpunkte.", "Try one of the two inner points.") },
    ],
  },
  {
    id: "s3-one-eye", stage: 3, minutes: 3, title: t("Ein Auge", "One eye"), steps: [
      { id: "find", kind: "select", size: 5, stones: [b(0, 1), b(1, 1), b(1, 0)], targets: [p(0, 0)], territory: [p(0, 0)], selectFrom: "empty", body: t("Ein vollständig umschlossener Innenpunkt heißt Auge.", "A completely enclosed inner point is called an eye."), task: t("Tippe auf das Auge.", "Tap the eye."), success: t("Das ist ein echtes Auge.", "That is a real eye."), wrong: t("Suche den leeren Punkt, dessen direkte Nachbarn schwarz sind.", "Find the empty point whose direct neighbors are black.") },
      { id: "not-enough", kind: "play", toPlay: "white", targets: [p(0, 0)], success: t("Weiß nimmt die letzte Freiheit und schlägt alle drei schwarzen Steine.", "White takes the last liberty and captures all three black stones."), size: 5, stones: [b(0, 1), b(1, 1), b(1, 0), w(0, 2), w(1, 2), w(2, 1), w(2, 0)], territory: [p(0, 0)], body: t("Ein Auge allein reicht normalerweise nicht. Wenn alle äußeren Freiheiten verschwinden, darf Weiß zuletzt im Auge schlagen.", "One eye is usually not enough. When every outside liberty is gone, White may finally capture by playing in the eye." ) },
    ],
  },
  {
    id: "s3-two-eyes", stage: 3, minutes: 3, title: t("Zwei Augen", "Two eyes"), steps: [
      { id: "mark", kind: "select", size: 7, stones: TWO_EYE_SHAPE, targets: [p(2, 3), p(4, 3)], territory: [p(2, 3), p(4, 3)], selectFrom: "empty", body: t("Der schwarze Trennstein macht aus einem Innenraum zwei getrennte Augen.", "The black divider turns one inner space into two separate eyes."), task: t("Markiere beide Augen.", "Mark both eyes."), success: t("Zwei getrennte Augen.", "Two separate eyes."), wrong: t("Wähle die beiden einzelnen Innenpunkte links und rechts.", "Choose the two single inner points on the left and right.") },
      { id: "cannot-fill", kind: "illegal", size: 7, stones: TWO_EYE_SHAPE, toPlay: "white", targets: [p(4, 3)], expectedError: "suicide", body: t("Weiß kann keines der Augen als ersten Zug legal besetzen.", "White cannot legally occupy either eye first."), task: t("Probiere es aus.", "Try it."), success: t("Deshalb kann die schwarze Gruppe nicht geschlagen werden.", "That is why the black group cannot be captured."), wrong: t("Versuche, in das rechte Auge zu spielen.", "Try to play in the right eye.") },
    ],
  },
  {
    id: "s3-false-eye", stage: 3, minutes: 4, title: t("Falsches Auge", "False eye"), steps: [
      { id: "real", kind: "info", size: 5, stones: [b(1, 2), b(2, 1), b(3, 2), b(2, 3), b(1, 1), b(3, 1), b(1, 3), b(3, 3)], territory: [p(2, 2)], body: t("Hier sind auch die Diagonalen stabil. Der Innenpunkt ist ein echtes Auge.", "Here the diagonals are also stable. The inner point is a real eye." ) },
      { id: "false", kind: "play", size: 5, stones: [b(2, 1), b(1, 2), b(3, 2), b(2, 3), w(2, 0), w(1, 1), w(3, 1)], toPlay: "white", targets: [p(2, 2)], body: t("Der obere schwarze Stein hat nur den Innenpunkt als Freiheit. Die diagonalen weißen Steine machen die Form verwundbar.", "The upper black stone has only the inner point as a liberty. The diagonal white stones make the shape vulnerable."), task: t("Spiele Weiß auf das scheinbare Auge.", "Play White on the apparent eye."), success: t("Weiß schlägt den oberen Stein. Es sah geschlossen aus, war aber kein sicheres Auge.", "White captures the upper stone. It looked closed, but it was not a secure eye."), wrong: t("Spiele auf den leeren Mittelpunkt.", "Play on the empty center point.") },
    ],
  },
  {
    id: "s3-life-death", stage: 3, minutes: 4, title: t("Leben oder Tod?", "Life or death?"), steps: [
      { id: "make-life", kind: "play", size: 7, stones: THREE_POINT_EYE, toPlay: "black", targets: [p(3, 3)], body: t("Schwarz hat einen geraden Innenraum aus drei Punkten.", "Black has a straight three-point inner space."), task: t("Teile ihn mit einem Zug in zwei Augen.", "Split it into two eyes with one move."), success: t("Der Mittelpunkt erzeugt links und rechts je ein Auge.", "The center point creates one eye on each side."), wrong: t("Nur der mittlere Innenpunkt trennt den Raum in zwei Augen.", "Only the middle inner point splits the space into two eyes.") },
      { id: "kill", kind: "play", size: 7, stones: THREE_POINT_EYE, toPlay: "white", targets: [p(3, 3)], replies: [p(2, 3), p(4, 3)], replyExplanations: [t("Weiß besetzt die Mitte. Die schwarze Gruppe ist noch auf dem Brett. Schau jetzt, wie Schwarz antwortet.", "White takes the center. The black group is still on the board. Now watch Black's reply."), t("Schwarz schließt links. Rechts bleibt der Gruppe nur noch eine Freiheit. Zeige jetzt den weißen Schlagzug.", "Black closes the left side. The group has only one liberty left on the right. Now reveal White's capturing move.")], body: t("Jetzt ist Weiß zuerst am Zug.", "Now White moves first."), task: t("Besetze den vitalen Punkt, bevor Schwarz zwei Augen bildet.", "Take the vital point before Black makes two eyes."), success: t("Weiß nimmt rechts die letzte Freiheit und schlägt alle schwarzen Steine dieser Gruppe. Deshalb verschwinden sie vom Brett.", "White takes the last liberty on the right and captures every black stone in this group. That is why they leave the board."), wrong: t("Der vitale Punkt liegt genau in der Mitte.", "The vital point is exactly in the middle.") },
    ],
  },
  {
    id: "s3-seki", stage: 3, minutes: 3, title: t("Seki", "Seki"), steps: [
      { id: "shared", kind: "select", size: 5, stones: SEKI, targets: [p(2, 1), p(2, 3)], selectFrom: "empty", body: t("Beide Gruppen teilen genau diese zwei Freiheiten. Wer zuerst eine besetzt, setzt auch seine eigene Gruppe ins Atari.", "Both groups share exactly these two liberties. Filling either one also puts your own group in atari."), task: t("Markiere die beiden gemeinsamen Freiheiten.", "Mark the two shared liberties."), success: t("Keine Seite kann sicher anfangen. Das heißt Seki.", "Neither side can safely start. This is called seki."), wrong: t("Suche die zwei freien Punkte direkt zwischen Schwarz und Weiß.", "Find the two empty points directly between Black and White.") },
      { id: "try-seki", kind: "play", size: 5, stones: SEKI, toPlay: "black", targets: [p(2, 1)], replies: [p(2, 3)], body: t("Probiere aus, warum Schwarz nicht anfangen kann.", "Try why Black cannot start safely."), task: t("Setze Schwarz auf den oberen gemeinsamen Punkt.", "Play Black on the upper shared point."), success: t("Weiß besetzt die andere Freiheit und schlägt Schwarz. Beide Gruppen leben, wenn keine Seite anfängt.", "White takes the other liberty and captures Black. Both groups live if neither side starts.") },
    ],
  },
  {
    id: "s3-connect", stage: 3, minutes: 3, title: t("Verbinden", "Connecting"), steps: [
      { id: "before", kind: "info", size: 5, stones: [b(1, 2), b(3, 2), w(1, 1), w(3, 3)], body: t("Getrennt müssen beide schwarzen Gruppen eigene Freiheiten und eigenen Augenraum finden.", "While separate, both black groups need their own liberties and eye space." ) },
      { id: "connect", kind: "play", size: 5, stones: [b(1, 2), b(3, 2), w(1, 1), w(3, 3)], toPlay: "black", targets: [p(2, 2)], body: t("Ein Zug kann beide Gruppen direkt verbinden.", "One move can connect both groups directly."), task: t("Verbinde Schwarz.", "Connect Black."), success: t("Jetzt teilen alle drei Steine ihre Freiheiten und ihren Raum.", "Now all three stones share their liberties and space."), wrong: t("Spiele in die Lücke zwischen den schwarzen Steinen.", "Play in the gap between the black stones.") },
    ],
  },
  {
    id: "s3-cut", stage: 3, minutes: 3, title: t("Schneiden", "Cutting"), steps: [
      { id: "cut", kind: "play", size: 5, stones: [w(1, 2), w(3, 2), b(2, 1), b(2, 3)], toPlay: "black", targets: [p(2, 2)], body: t("Der mittlere Punkt ist die einzige direkte Verbindung zwischen den weißen Seiten.", "The center point is the only direct connection between White's two sides."), task: t("Besetze ihn mit Schwarz.", "Occupy it with Black."), success: t("Weiß bleibt in zwei Gruppen getrennt. Beide müssen nun selbst überleben.", "White remains split into two groups. Each must now survive on its own."), wrong: t("Spiele auf den Punkt genau zwischen den weißen Steinen.", "Play on the point exactly between the white stones.") },
    ],
  },
  {
    id: "s3-weak-groups", stage: 3, minutes: 3, title: t("Schwache Gruppen", "Weak groups"), steps: [
      { id: "compare", kind: "select", size: 7, stones: [b(0, 1), b(1, 1), b(0, 2), b(1, 2), b(5, 5), w(4, 5), w(5, 4), w(6, 5)], targets: [p(5, 5)], selectFrom: "stone", body: t("Links hat Schwarz Platz, mehrere Freiheiten und Verbindungen. Rechts ist ein einzelner Stein fast umzingelt.", "On the left, Black has space, several liberties, and connections. On the right, one stone is nearly surrounded."), task: t("Tippe auf die Gruppe, die zuerst Hilfe braucht.", "Tap the group that needs help first."), success: t("Der einzelne Stein hat wenig Freiheiten und keinen Augenraum. Er ist die schwache Gruppe.", "The lone stone has few liberties and no eye space. It is the weak group."), wrong: t("Vergleiche Freiheiten, Platz und Verbindungsmöglichkeiten.", "Compare liberties, space, and connection options.") },
    ],
  },
  {
    id: "s3-sacrifice", stage: 3, minutes: 3, title: t("Nicht jeden Stein retten", "Do not save every stone"), steps: [
      { id: "bigger", kind: "play", size: 9, stones: [b(1, 1), w(0, 1), w(1, 0), w(2, 1), ...[4, 5, 6, 7, 8].flatMap((x) => [b(x, 4), b(x, 6)]), b(4, 5), b(8, 5), ...[3, 4, 5, 6, 7, 8].flatMap((x) => [w(x, 3), w(x, 7)]), w(3, 4), w(3, 5), w(3, 6)], toPlay: "black", targets: [p(6, 5)], emphasis: [p(1, 2), p(6, 5)], body: t("Der einzelne Stein links ist im Atari. Ihn zu retten kostet Züge; rechts braucht die große Gruppe zwei Augen.", "The lone stone on the left is in atari. Saving it costs moves; on the right, the large group needs two eyes."), task: t("Spiele den wichtigeren Zug rechts.", "Play the more important move on the right."), success: t("Ein Stein ist nur ein Stein. Die größere Gruppe und ihr Raum sind wichtiger.", "One stone is only one stone. The larger group and its space matter more."), wrong: t("Der markierte Fluchtpunkt links rettet nur einen Stein. Teile den Augenraum rechts.", "The marked escape on the left saves only one stone. Split the eye space on the right.") },
    ],
  },
  {
    id: "s3-challenge", stage: 3, minutes: 6, challenge: true, title: t("Life-&-Death-Challenge", "Life-and-death challenge"), steps: [
      { id: "live", kind: "play", size: 7, stones: THREE_POINT_EYE, toPlay: "black", targets: [p(3, 3)], body: t("Bringe Schwarz zum Leben.", "Make Black live."), task: t("Finde den Zug für zwei Augen.", "Find the move for two eyes."), success: t("Zwei Augen.", "Two eyes."), wrong: t("Teile den Innenraum in der Mitte.", "Split the inner space in the middle.") },
      { id: "kill", kind: "play", size: 7, stones: THREE_POINT_EYE, toPlay: "white", targets: [p(3, 3)], body: t("Töte die schwarze Form.", "Kill the black shape."), task: t("Besetze den vitalen Punkt.", "Take the vital point."), success: t("Schwarz kann keine zwei Augen mehr bilden.", "Black can no longer make two eyes."), wrong: t("Der vitale Punkt liegt in der Mitte.", "The vital point is in the middle.") },
      { id: "false-eye", kind: "play", size: 5, stones: [b(2, 1), b(1, 2), b(3, 2), b(2, 3), w(2, 0), w(1, 1), w(3, 1)], toPlay: "white", targets: [p(2, 2)], body: t("Zerstöre das falsche Auge.", "Destroy the false eye."), task: t("Spiele Weiß.", "Play White."), success: t("Der diagonale Defekt lässt Weiß schlagen.", "The diagonal defect lets White capture."), wrong: t("Spiele auf den scheinbaren Augenpunkt.", "Play on the apparent eye point.") },
      { id: "connect", kind: "play", size: 5, stones: [b(1, 2), b(3, 2)], toPlay: "black", targets: [p(2, 2)], body: t("Verbinde die schwarzen Gruppen.", "Connect the black groups."), task: t("Spiele den Verbindungszug.", "Play the connecting move."), success: t("Eine Gruppe teilt alle Freiheiten.", "One group shares all liberties."), wrong: t("Spiele zwischen beide Steine.", "Play between the two stones.") },
      { id: "cut", kind: "play", size: 5, stones: [w(1, 2), w(3, 2)], toPlay: "black", targets: [p(2, 2)], body: t("Halte Weiß getrennt.", "Keep White separated."), task: t("Finde den Schnitt.", "Find the cut."), success: t("Weiß bleibt zwei Gruppen.", "White remains two groups."), wrong: t("Besetze die Lücke.", "Occupy the gap.") },
      { id: "weak", kind: "select", size: 7, stones: [b(0, 1), b(1, 1), b(0, 2), b(1, 2), b(5, 5), w(4, 5), w(5, 4), w(6, 5)], targets: [p(5, 5)], selectFrom: "stone", body: t("Welche schwarze Gruppe ist schwach?", "Which black group is weak?"), task: t("Tippe sie an.", "Tap it."), success: t("Wenig Freiheiten, kein Augenraum: diese Gruppe braucht Hilfe.", "Few liberties and no eye space: this group needs help."), wrong: t("Vergleiche den sicheren Block links mit dem Einzelstein rechts.", "Compare the safe block on the left with the lone stone on the right.") },
    ],
  },
  {
    id: "s3-second-game", stage: 3, minutes: 8, challenge: true, title: t("Zweite 9×9-Partie", "Second 9×9 game"), steps: [
      { id: "game", kind: "beginner-game", body: t("Spiele eine vollständige 9×9-Partie gegen Beginner Bot I. Während der Partie gibt es keine Gefahrenhinweise.", "Play a complete 9×9 game against Beginner Bot I. There are no danger hints during the game."), task: t("Nach der Partie siehst du höchstens drei konkrete Lernmomente.", "After the game, you will see no more than three concrete learning moments." ) },
    ],
  },
] as const;

export const LEARN_STAGES: readonly LearnStage[] = ([
  { id: 1, title: t("Deine ersten Steine", "Your first stones"), lessons: STAGE_ONE },
  { id: 2, title: t("Deine erste Go-Partie", "Your first Go game"), lessons: STAGE_TWO },
  { id: 3, title: t("Überleben", "Survival"), lessons: STAGE_THREE },
  ...LATER_STAGES,
] satisfies readonly LearnStage[]).map((stage) => ({ ...stage, lessons: stage.lessons.map(stableLessonColor) }));

export const LEARN_LESSONS: readonly LearnLesson[] = LEARN_STAGES.flatMap((stage) => stage.lessons);

export function learnLocale(locale: string): LearnLocale {
  return locale === "de" ? "de" : "en";
}

export function line(copy: LocalizedLine, locale: string): string {
  return copy[learnLocale(locale)];
}

const LEARN_UI_COPY = {
  de: {
    boardLabel: "{size} mal {size} Lernbrett",
    blackStoneAt: "Schwarzer Stein auf {coordinate}",
    whiteStoneAt: "Weißer Stein auf {coordinate}",
    emptyAt: "Freier Schnittpunkt {coordinate}",
    learn: "Lernen",
    wholeBoard: "Ganzes Brett anzeigen",
    enlargeBoard: "Brett vergrößern · dann verschieben",
    winCheckpointOpen: "Diese Sieg-Challenge bleibt offen. Schau dir die Lernmomente an und spiele erneut.",
    allStagesComplete: "Alle acht Etappen abgeschlossen",
    keepPracticing: "Weiter üben",
    ownGameLearning: "Weiterlernen in eigenen Partien",
    playGame: "Partie spielen",
    reviewOwnGame: "Eigene Partie analysieren",
    boardPuzzles: "Brettaufgaben",
    lessonsComplete: "{done} von {total} Lektionen abgeschlossen",
    continue: "Weiter",
    showNextMove: "Nächsten Zug zeigen",
    yourBlackTurn: "Du spielst Schwarz.",
    yourWhiteTurn: "Du spielst Weiß.",
    watchContinuation: "Die Antwort ist gespielt. Weitere Trainerzüge zeigst du einzeln.",
    explanation: "Erklärung",
    explanationHelp: "Ansehen, dann „Weiter“.",
    taskTurn: "Du bist dran",
    boardTaskHelp: "Antworte auf dem Brett.",
    passTaskHelp: "Tippe unten auf „Passen“.",
    practiceGame: "Partie",
    practiceGameHelp: "Du spielst Schwarz.",
    taskSolved: "Erledigt",
    readyToContinue: "Du kannst weitergehen.",
    nextLesson: "Nächste Lektion",
    continueLearning: "Weiterlernen",
    nextStage: "Nächste Etappe",
    stages: "Etappen",
    stage: "Etappe {stage}",
    complete: "Abgeschlossen",
    minutes: "{minutes} Min.",
    checkpoint: "Checkpoint",
    later: "Danach",
    futureTopics: "Taktik · gutes 9×9 · 13×13 · 19×19 · eigene Partien analysieren",
    futureNote: "Diese Etappen werden später ergänzt.",
    learningPath: "Lernpfad",
    correct: "Richtig.",
    checkAgain: "Prüfe die Stellung noch einmal.",
    markedCount: "{done} von {total} markiert.",
    ruleNotShown: "Dieser Versuch zeigt die Regel noch nicht.",
    noLiberty: "Der Stein hätte keine Freiheit.",
    koBlocked: "Dieser Rückschlag ist wegen Ko noch gesperrt.",
    pointOccupied: "Dieser Punkt ist nicht frei.",
    pass: "Passen",
    hint: "Hinweis",
    restart: "Neu starten",
    completeLesson: "Lektion abschließen",
    challengeComplete: "Challenge bestanden.",
    fullGameComplete: "Die Partie ist vollständig beendet.",
    botCapturedFirst: "Weiß hat zuerst geschlagen. Starte neu und halte deine Gruppen verbunden.",
    markDeadNow: "Markiere jetzt tote Gruppen. Tippe eine Gruppe an, um sie zu markieren.",
    groupInAtari: "Eine deiner Gruppen hat nur noch eine Freiheit.",
    suicideMove: "Dieser Zug wäre Selbstmord.",
    koImmediate: "Im Ko darfst du nicht sofort zurückschlagen.",
    captureLearned: "Du weißt jetzt, wie Steine geschlagen werden.",
    openAreas: "Auf dem Brett gibt es noch offene Bereiche. Du kannst weiterspielen oder mit einem zweiten Tippen trotzdem passen.",
    bothPassed: "Beide haben gepasst. Markiere tote Gruppen; wenn keine tot ist, bestätige direkt.",
    invalidDead: "Diese Markierung liegt nicht vollständig im gegnerischen Gebiet. Markiere immer die ganze tote Gruppe – oder entferne die Markierung.",
    yourTurn: "Du bist am Zug",
    botTurn: "Bot zieht",
    modelFailed: "Der Bot konnte keinen Zug berechnen. Versuche es erneut; deine Stellung bleibt erhalten.",
    retryBot: "Botzug erneut berechnen",
    neutralPoints: "Neutrale Bereiche",
    resumeGame: "Weiterspielen",
    reviewAtari: "Diese schwarze Gruppe hatte hier nur eine Freiheit. Weiß schlug im nächsten Zug {count} Steine.",
    reviewConnection: "Auf {coordinate} konntest du diese {count} Gruppen verbinden. Eine davon hatte höchstens zwei Freiheiten.",
    reviewCapture: "Hier hast du die letzte Freiheit genommen und {count} weiße Steine geschlagen.",
    markDead: "Tote Gruppen markieren",
    won: "Gewonnen",
    gameFinished: "Partie beendet",
    moves: "Züge",
    settlementHelp: "Tippe auf tote Gruppen. Gehört ein freier Bereich keiner Seite, markiere darin einen Punkt unter ‚Neutrale Bereiche‘. Der Lernbot akzeptiert deine bestätigte Markierung.",
    confirmScore: "Markierung bestätigen und zählen",
    black: "Schwarz",
    white: "Weiß",
    whiteWithKomi: "Weiß inkl. 6,5 Komi",
    draw: "Unentschieden",
    learningMoment: "Lernmoment {current} von {total}",
    nextMoment: "Nächsten Moment zeigen",
    tryAgain: "Noch einmal",
    weakGroupReview: "Diese schwarze Gruppe hatte am Ende {liberties} Freiheiten. Gruppen mit wenig Freiheiten und ohne Innenraum brauchen früh Hilfe.",
    capturesReview: "Du hast {blackCaptures} weiße Steine geschlagen; Weiß hat {whiteCaptures} schwarze Steine geschlagen.",
  },
  en: {
    boardLabel: "{size} by {size} teaching board",
    blackStoneAt: "Black stone on {coordinate}",
    whiteStoneAt: "White stone on {coordinate}",
    emptyAt: "Empty intersection {coordinate}",
    learn: "Learn",
    wholeBoard: "Show whole board",
    enlargeBoard: "Enlarge board · then pan",
    winCheckpointOpen: "This win checkpoint remains open. Review the learning moments and try again.",
    allStagesComplete: "All eight stages completed",
    keepPracticing: "Keep practicing",
    ownGameLearning: "Keep learning in your own games",
    playGame: "Play a game",
    reviewOwnGame: "Review your game",
    boardPuzzles: "Board puzzles",
    lessonsComplete: "{done} of {total} lessons complete",
    continue: "Continue",
    showNextMove: "Show next move",
    yourBlackTurn: "You play Black.",
    yourWhiteTurn: "You play White.",
    watchContinuation: "The reply is on the board. Reveal further trainer moves one at a time.",
    explanation: "Explanation",
    explanationHelp: "Look, then tap ‘Continue’.",
    taskTurn: "Your task",
    boardTaskHelp: "Answer on the board.",
    passTaskHelp: "Tap ‘Pass’ below.",
    practiceGame: "Game",
    practiceGameHelp: "You play Black.",
    taskSolved: "Done",
    readyToContinue: "You can continue.",
    nextLesson: "Next lesson",
    continueLearning: "Continue learning",
    nextStage: "Next stage",
    stages: "Stages",
    stage: "Stage {stage}",
    complete: "Complete",
    minutes: "{minutes} min",
    checkpoint: "Checkpoint",
    later: "Next",
    futureTopics: "Tactics · strong 9×9 · 13×13 · 19×19 · analyzing your own games",
    futureNote: "These stages will be added later.",
    learningPath: "Learning path",
    correct: "Correct.",
    checkAgain: "Check the position again.",
    markedCount: "{done} of {total} marked.",
    ruleNotShown: "That attempt does not show the rule yet.",
    noLiberty: "The stone would have no liberty.",
    koBlocked: "This recapture is still blocked by ko.",
    pointOccupied: "That point is not empty.",
    pass: "Pass",
    hint: "Hint",
    restart: "Restart",
    completeLesson: "Complete lesson",
    challengeComplete: "Challenge complete.",
    fullGameComplete: "The full game is complete.",
    botCapturedFirst: "White captured first. Restart and keep your groups connected.",
    markDeadNow: "Now mark dead groups. Tap a group to mark it.",
    groupInAtari: "One of your groups has only one liberty left.",
    suicideMove: "That move would be suicide.",
    koImmediate: "You may not recapture a ko immediately.",
    captureLearned: "You now know how stones are captured.",
    openAreas: "There are still open regions. You can keep playing or tap Pass again to pass anyway.",
    bothPassed: "Both players passed. Mark dead groups; if none are dead, confirm directly.",
    invalidDead: "That marking is not fully inside opposing territory. Mark the entire dead group—or remove the marking.",
    yourTurn: "Your turn",
    botTurn: "Bot to move",
    modelFailed: "The bot could not calculate a move. Retry; your position is preserved.",
    retryBot: "Retry bot move",
    neutralPoints: "Neutral regions",
    resumeGame: "Resume play",
    reviewAtari: "This black group had only one liberty here. White captured {count} stones on the next move.",
    reviewConnection: "At {coordinate} you could connect these {count} groups. One had at most two liberties.",
    reviewCapture: "Here you took the last liberty and captured {count} white stones.",
    markDead: "Mark dead groups",
    won: "Won",
    gameFinished: "Game finished",
    moves: "moves",
    settlementHelp: "Tap dead groups. If an empty region belongs to neither side, mark a point inside it under ‘Neutral regions’. The learning bot accepts your confirmed marking.",
    confirmScore: "Confirm and count",
    black: "Black",
    white: "White",
    whiteWithKomi: "White incl. 6.5 komi",
    draw: "Draw",
    learningMoment: "Learning moment {current} of {total}",
    nextMoment: "Show next moment",
    tryAgain: "Try again",
    weakGroupReview: "This black group ended with {liberties} liberties. Groups with few liberties and no inner space need help early.",
    capturesReview: "You captured {blackCaptures} white stones; White captured {whiteCaptures} black stones.",
  },
} as const;

export function learnUiCopy(locale: string) {
  return LEARN_UI_COPY[learnLocale(locale)];
}

export function formatLearn(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), template);
}

export function lessonById(id: LearnLessonId): LearnLesson {
  const lesson = LEARN_LESSONS.find((candidate) => candidate.id === id);
  if (!lesson) throw new Error(`Unknown learning lesson ${id}.`);
  return lesson;
}
