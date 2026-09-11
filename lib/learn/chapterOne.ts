import type { Position, Stone } from "@/lib/game/types";
import { kyChapterOne } from "@/lib/i18n/catalogs/ky";
import type { Locale } from "@/lib/i18n/config";

export const CHAPTER_ONE_LESSON_IDS = ["place", "liberties", "capture", "escape", "connect", "territory"] as const;

export type ChapterOneLessonId = (typeof CHAPTER_ONE_LESSON_IDS)[number];
export type LessonStone = Position & { color: Stone };
export type LessonDefinition = { id: ChapterOneLessonId };

export type LessonText = {
  title: string;
  shortTitle: string;
  summary: string;
  instruction: string;
  hint: string;
  wrong: string;
  success: string;
};

export type ChapterOneCopy = {
  kicker: string;
  title: string;
  description: string;
  stepLabel: string;
  progressLabel: string;
  resetProgress: string;
  lessonNavigation: string;
  boardLabel: string;
  blackToPlay: string;
  markLiberties: string;
  instructionLabel: string;
  hint: string;
  hideHint: string;
  restartLesson: string;
  previousLesson: string;
  nextLesson: string;
  finishChapter: string;
  chapterComplete: string;
  chapterCompleteBody: string;
  playNine: string;
  occupiedPoint: string;
  libertyProgress: string;
  emptyPoint: string;
  blackStone: string;
  whiteStone: string;
  suggestedPoint: string;
  territoryPoint: string;
  libertyPoint: string;
  lessons: Record<ChapterOneLessonId, LessonText>;
};

export const CHAPTER_ONE_LESSONS: readonly LessonDefinition[] = CHAPTER_ONE_LESSON_IDS.map((id) => ({ id }));

export const LESSON_BOARD_SIZE = 5;
export const PLACE_MOVE = { x: 2, y: 2 } as const;
export const LIBERTY_POINTS = [
  { x: 2, y: 1 },
  { x: 1, y: 2 },
  { x: 3, y: 2 },
  { x: 2, y: 3 },
] as const;
export const CAPTURE_MOVE = { x: 2, y: 3 } as const;
export const ESCAPE_MOVE = { x: 2, y: 3 } as const;
export const CONNECT_MOVE = { x: 2, y: 2 } as const;
export const TERRITORY_POINT = { x: 2, y: 2 } as const;
export const TERRITORY_MOVE = { x: 2, y: 3 } as const;

export const LESSON_SETUPS: Record<ChapterOneLessonId, readonly LessonStone[]> = {
  place: [],
  liberties: [{ x: 2, y: 2, color: "black" }],
  capture: [
    { x: 2, y: 2, color: "white" },
    { x: 2, y: 1, color: "black" },
    { x: 1, y: 2, color: "black" },
    { x: 3, y: 2, color: "black" },
  ],
  escape: [
    { x: 2, y: 2, color: "black" },
    { x: 2, y: 1, color: "white" },
    { x: 1, y: 2, color: "white" },
    { x: 3, y: 2, color: "white" },
  ],
  connect: [
    { x: 1, y: 2, color: "black" },
    { x: 3, y: 2, color: "black" },
  ],
  territory: [
    { x: 2, y: 1, color: "black" },
    { x: 1, y: 2, color: "black" },
    { x: 3, y: 2, color: "black" },
  ],
};

const en: ChapterOneCopy = {
  kicker: "Beginner lesson",
  title: "The basic rules of Go.",
  description: "Six short steps show you how to place stones, keep them alive, capture, connect, and make territory.",
  stepLabel: "Step",
  progressLabel: "Your progress",
  resetProgress: "Start over",
  lessonNavigation: "Steps in the beginner lesson",
  boardLabel: "Practice board",
  blackToPlay: "Black to play",
  markLiberties: "Find the liberties",
  instructionLabel: "On the board",
  hint: "Show hint",
  hideHint: "Hide hint",
  restartLesson: "Restart step",
  previousLesson: "Back",
  nextLesson: "Next step",
  finishChapter: "Try 9×9",
  chapterComplete: "Beginner lesson complete",
  chapterCompleteBody: "You now know the basic flow: place stones, count liberties, capture, connect, and surround territory.",
  playNine: "Try a 9×9 game",
  occupiedPoint: "There is already a stone on that point.",
  libertyProgress: "Correct: {count} of 4 liberties found.",
  emptyPoint: "Empty intersection {coordinate}",
  blackStone: "Black stone on {coordinate}",
  whiteStone: "White stone on {coordinate}",
  suggestedPoint: "Suggested move on {coordinate}",
  territoryPoint: "Point to surround on {coordinate}",
  libertyPoint: "Marked liberty on {coordinate}",
  lessons: {
    place: {
      shortTitle: "Place a stone",
      title: "Place your first stone.",
      summary: "Black and White take turns placing stones on intersections. Black begins. Once placed, a stone stays where it is unless it is captured.",
      instruction: "Place a black stone on the marked centre point.",
      hint: "Choose the intersection in the middle of the board.",
      wrong: "Use the marked intersection in the centre.",
      success: "Good. Stones are played on intersections, not inside the squares.",
    },
    liberties: {
      shortTitle: "Liberties",
      title: "Find the liberties.",
      summary: "A liberty is an empty point directly above, below, left, or right of a stone. Diagonal points do not count.",
      instruction: "Find all four liberties of the black stone by clicking them one after another.",
      hint: "Follow the four lines leading out from the stone.",
      wrong: "That is not a liberty. Only empty neighbours connected by a line count.",
      success: "Exactly four. A lone stone in the centre starts with four liberties.",
    },
    capture: {
      shortTitle: "Capture",
      title: "Capture a stone.",
      summary: "The white stone has only one liberty left. A stone or group with one liberty is in atari.",
      instruction: "Play Black on White's last liberty. The white stone will be removed from the board.",
      hint: "The last free point is directly below the white stone.",
      wrong: "Find the only empty point directly next to the white stone.",
      success: "Captured. A stone with no liberties is removed from the board.",
    },
    escape: {
      shortTitle: "Escape",
      title: "Save a stone.",
      summary: "This time your black stone has only one liberty. If White fills it next, Black is captured.",
      instruction: "Extend Black onto its last liberty. The two connected stones will gain new liberties.",
      hint: "Play directly below the black stone.",
      wrong: "Play on the black stone's last liberty before White takes it.",
      success: "Saved. The new stone connects to the first and gives the group more liberties.",
    },
    connect: {
      shortTitle: "Connect",
      title: "Connect your stones.",
      summary: "Stones touching along a line form one group. Diagonally separated stones remain separate groups.",
      instruction: "Place one black stone in the gap to join both stones into a single group.",
      hint: "Play exactly between the two black stones.",
      wrong: "Place the stone in the gap between the two black stones.",
      success: "Connected. All three stones now form one group and share their liberties.",
    },
    territory: {
      shortTitle: "Territory",
      title: "Surround territory.",
      summary: "When both players pass, the game is scored. Enclosed empty points and captured stones count toward your result.",
      instruction: "Close the gap below the marked point to surround one point of territory.",
      hint: "Play directly below the marked centre point.",
      wrong: "Close the gap below the marked point.",
      success: "Correct. The marked empty point is now surrounded by Black.",
    },
  },
};

const de: ChapterOneCopy = {
  kicker: "Einsteigerlektion",
  title: "Die Grundregeln von Go.",
  description: "Sechs kurze Schritte zeigen dir, wie du Steine setzt, sie am Leben hältst, schlägst, verbindest und Gebiet bildest.",
  stepLabel: "Schritt",
  progressLabel: "Fortschritt",
  resetProgress: "Von vorn beginnen",
  lessonNavigation: "Schritte der Einsteigerlektion",
  boardLabel: "Übungsbrett",
  blackToPlay: "Schwarz am Zug",
  markLiberties: "Finde die Freiheiten",
  instructionLabel: "Auf dem Brett",
  hint: "Hinweis zeigen",
  hideHint: "Hinweis ausblenden",
  restartLesson: "Schritt neu starten",
  previousLesson: "Zurück",
  nextLesson: "Nächster Schritt",
  finishChapter: "9×9 ausprobieren",
  chapterComplete: "Einsteigerlektion abgeschlossen",
  chapterCompleteBody: "Du kennst jetzt den grundlegenden Ablauf: Steine setzen, Freiheiten zählen, schlagen, verbinden und Gebiet umschließen.",
  playNine: "9×9-Partie ausprobieren",
  occupiedPoint: "Auf diesem Punkt liegt bereits ein Stein.",
  libertyProgress: "Richtig: {count} von 4 Freiheiten gefunden.",
  emptyPoint: "Leerer Schnittpunkt {coordinate}",
  blackStone: "Schwarzer Stein auf {coordinate}",
  whiteStone: "Weißer Stein auf {coordinate}",
  suggestedPoint: "Empfohlener Zug auf {coordinate}",
  territoryPoint: "Zu umschließender Punkt auf {coordinate}",
  libertyPoint: "Markierte Freiheit auf {coordinate}",
  lessons: {
    place: {
      shortTitle: "Stein setzen",
      title: "Setze deinen ersten Stein.",
      summary: "Schwarz und Weiß setzen abwechselnd einen Stein auf einen Schnittpunkt. Schwarz beginnt. Ein gesetzter Stein bleibt liegen, bis er geschlagen wird.",
      instruction: "Setze einen schwarzen Stein auf den markierten Punkt in der Mitte.",
      hint: "Wähle den Schnittpunkt genau in der Brettmitte.",
      wrong: "Nutze den markierten Schnittpunkt in der Mitte.",
      success: "Gut. Steine werden auf Schnittpunkte gesetzt, nicht in die Felder.",
    },
    liberties: {
      shortTitle: "Freiheiten",
      title: "Finde die Freiheiten.",
      summary: "Eine Freiheit ist ein leerer Punkt direkt über, unter, links oder rechts neben einem Stein. Diagonalen zählen nicht.",
      instruction: "Finde alle vier Freiheiten des schwarzen Steins, indem du sie nacheinander anklickst.",
      hint: "Folge den vier Linien, die vom Stein wegführen.",
      wrong: "Das ist keine Freiheit. Nur leere Nachbarpunkte entlang einer Linie zählen.",
      success: "Genau vier. Ein einzelner Stein in der Mitte beginnt mit vier Freiheiten.",
    },
    capture: {
      shortTitle: "Schlagen",
      title: "Schlage einen Stein.",
      summary: "Der weiße Stein hat nur noch eine Freiheit. Ein Stein oder eine Gruppe mit einer Freiheit steht im Atari.",
      instruction: "Spiele Schwarz auf die letzte Freiheit von Weiß. Danach wird der weiße Stein vom Brett entfernt.",
      hint: "Der letzte freie Punkt liegt direkt unter dem weißen Stein.",
      wrong: "Finde den einzigen freien Punkt direkt neben dem weißen Stein.",
      success: "Geschlagen. Ein Stein ohne Freiheiten wird vom Brett entfernt.",
    },
    escape: {
      shortTitle: "Retten",
      title: "Rette einen Stein.",
      summary: "Diesmal hat dein schwarzer Stein nur noch eine Freiheit. Besetzt Weiß sie im nächsten Zug, wird Schwarz geschlagen.",
      instruction: "Verlängere Schwarz auf seine letzte Freiheit. Die zwei verbundenen Steine erhalten dadurch neue Freiheiten.",
      hint: "Spiele direkt unter dem schwarzen Stein.",
      wrong: "Spiele auf die letzte Freiheit des schwarzen Steins, bevor Weiß sie nimmt.",
      success: "Gerettet. Der neue Stein verbindet sich mit dem ersten und gibt der Gruppe mehr Freiheiten.",
    },
    connect: {
      shortTitle: "Verbinden",
      title: "Verbinde deine Steine.",
      summary: "Steine, die sich entlang einer Linie berühren, bilden eine Gruppe. Diagonal getrennte Steine bleiben getrennte Gruppen.",
      instruction: "Setze einen schwarzen Stein in die Lücke und verbinde beide Steine zu einer Gruppe.",
      hint: "Spiele genau zwischen die beiden schwarzen Steine.",
      wrong: "Setze den Stein in die Lücke zwischen den beiden schwarzen Steinen.",
      success: "Verbunden. Alle drei Steine bilden jetzt eine Gruppe und teilen ihre Freiheiten.",
    },
    territory: {
      shortTitle: "Gebiet",
      title: "Umschließe Gebiet.",
      summary: "Wenn beide Spieler passen, wird gewertet. Umschlossene leere Punkte und geschlagene Steine zählen für dein Ergebnis.",
      instruction: "Schließe die Lücke unter dem markierten Punkt und umschließe einen Punkt Gebiet.",
      hint: "Spiele direkt unter dem markierten Punkt in der Mitte.",
      wrong: "Schließe die Lücke unter dem markierten Punkt.",
      success: "Richtig. Der markierte leere Punkt ist jetzt von Schwarz umschlossen.",
    },
  },
};

export function chapterOneCopy(locale: Locale): ChapterOneCopy {
  if (locale === "de") return de;
  if (locale === "ky") return kyChapterOne;
  return en;
}

export function lessonPositionKey(position: Position): string {
  return `${position.x}:${position.y}`;
}

export function sameLessonPosition(left: Position, right: Position): boolean {
  return left.x === right.x && left.y === right.y;
}

export function lessonCoordinate(size: number, position: Position): string {
  const alphabet = "ABCDEFGHJKLMNOPQRST";
  return `${alphabet[position.x] ?? "?"}${size - position.y}`;
}

export function replaceLessonTokens(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
