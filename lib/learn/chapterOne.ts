import type { Locale } from "@/lib/i18n/config";
import type { Position, Stone } from "@/lib/game/types";

export const CHAPTER_ONE_LESSON_IDS = [
  "goal",
  "liberties",
  "capture",
  "escape",
  "connect",
  "capture-group",
] as const;

export type ChapterOneLessonId = (typeof CHAPTER_ONE_LESSON_IDS)[number];
export type LessonStone = Position & { color: Stone };

export type LessonDefinition = {
  id: ChapterOneLessonId;
  minutes: number;
};

export type LessonText = {
  title: string;
  shortTitle: string;
  eyebrow: string;
  summary: string;
  instruction: string;
  hint: string;
  success: string;
  takeaway: string;
};

export type ChapterOneCopy = {
  kicker: string;
  title: string;
  description: string;
  chapterLabel: string;
  chapterSummary: string;
  progressLabel: string;
  lessonsLabel: string;
  minuteLabel: string;
  resetProgress: string;
  lessonNavigation: string;
  boardLabel: string;
  boardContext: string;
  blackToPlay: string;
  markLiberties: string;
  guidedExercise: string;
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
  feedbackIdle: string;
  feedbackWrong: string;
  libertyProgress: string;
  emptyPoint: string;
  blackStone: string;
  whiteStone: string;
  suggestedPoint: string;
  territoryPoint: string;
  libertyPoint: string;
  takeawayLabel: string;
  lessons: Record<ChapterOneLessonId, LessonText>;
};

export const CHAPTER_ONE_LESSONS: readonly LessonDefinition[] = [
  { id: "goal", minutes: 3 },
  { id: "liberties", minutes: 4 },
  { id: "capture", minutes: 3 },
  { id: "escape", minutes: 3 },
  { id: "connect", minutes: 3 },
  { id: "capture-group", minutes: 4 },
] as const;

export const LESSON_BOARD_SIZE = 5;
export const GOAL_POSITION = { x: 2, y: 2 } as const;
export const GOAL_CLOSING_MOVE = { x: 2, y: 3 } as const;
export const LIBERTY_POINTS = [
  { x: 2, y: 1 },
  { x: 1, y: 2 },
  { x: 3, y: 2 },
  { x: 2, y: 3 },
] as const;
export const CAPTURE_MOVE = { x: 2, y: 3 } as const;
export const ESCAPE_MOVE = { x: 2, y: 3 } as const;
export const CONNECT_MOVE = { x: 2, y: 2 } as const;
export const GROUP_CAPTURE_MOVE = { x: 2, y: 4 } as const;

export const LESSON_SETUPS: Record<ChapterOneLessonId, readonly LessonStone[]> = {
  goal: [
    { x: 2, y: 1, color: "black" },
    { x: 1, y: 2, color: "black" },
    { x: 3, y: 2, color: "black" },
    { x: 4, y: 1, color: "white" },
  ],
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
  "capture-group": [
    { x: 2, y: 2, color: "white" },
    { x: 2, y: 3, color: "white" },
    { x: 2, y: 1, color: "black" },
    { x: 1, y: 2, color: "black" },
    { x: 3, y: 2, color: "black" },
    { x: 1, y: 3, color: "black" },
    { x: 3, y: 3, color: "black" },
  ],
};

const en: ChapterOneCopy = {
  kicker: "Learn Go by playing",
  title: "Understand Go, one move at a time.",
  description: "This first chapter teaches the ideas you need at the board: territory, liberties, atari, capturing, escaping, and connecting stones.",
  chapterLabel: "Chapter 1 · Liberties & capturing",
  chapterSummary: "Six short exercises from the objective of Go to your first captured group.",
  progressLabel: "Progress",
  lessonsLabel: "lessons",
  minuteLabel: "min",
  resetProgress: "Reset",
  lessonNavigation: "Lessons in chapter 1",
  boardLabel: "Interactive teaching board",
  boardContext: "5×5 practice board",
  blackToPlay: "Play Black",
  markLiberties: "Find the liberties",
  guidedExercise: "On the board",
  instructionLabel: "Your move",
  hint: "Show hint",
  hideHint: "Hide hint",
  restartLesson: "Restart",
  previousLesson: "Previous",
  nextLesson: "Next lesson",
  finishChapter: "Try 9×9",
  chapterComplete: "Chapter 1 complete",
  chapterCompleteBody: "You can now identify liberties, capture a stone or group, escape from atari, and connect stones.",
  playNine: "Try a 9×9 game",
  feedbackIdle: "Use the board to solve the task.",
  feedbackWrong: "Not quite. Only points directly connected by a line matter here—diagonals do not.",
  libertyProgress: "Correct: {count} of 4 liberties found.",
  emptyPoint: "Empty intersection {coordinate}",
  blackStone: "Black stone on {coordinate}",
  whiteStone: "White stone on {coordinate}",
  suggestedPoint: "Suggested move on {coordinate}",
  territoryPoint: "Point to surround on {coordinate}",
  libertyPoint: "Marked liberty on {coordinate}",
  takeawayLabel: "Remember",
  lessons: {
    goal: {
      eyebrow: "Lesson 1 of 6",
      shortTitle: "The objective",
      title: "Surround empty space.",
      summary: "You win Go by controlling more of the board than your opponent. Empty points enclosed by your stones become territory.",
      instruction: "Black has surrounded the golden point on three sides. Close the one remaining gap.",
      hint: "Play directly below the golden point.",
      success: "Correct. The empty golden point is now enclosed by Black.",
      takeaway: "Territory is the objective. Capturing helps you protect it and break the opponent's boundaries.",
    },
    liberties: {
      eyebrow: "Lesson 2 of 6",
      shortTitle: "Liberties",
      title: "Every stone needs liberties.",
      summary: "A liberty is an empty point directly above, below, left, or right of a stone. Diagonal points do not count.",
      instruction: "Find all four liberties of the black stone by clicking them one after another.",
      hint: "Follow the four lines leading out from the stone.",
      success: "Exactly four. A lone stone in the centre starts with four liberties.",
      takeaway: "Before every fight, count the liberties of your stones and the opponent's stones.",
    },
    capture: {
      eyebrow: "Lesson 3 of 6",
      shortTitle: "Capture",
      title: "Take the last liberty.",
      summary: "The white stone has only one liberty left. A stone or group with one liberty is in atari.",
      instruction: "Play Black on White's last liberty. The white stone will be removed from the board.",
      hint: "The last free point is directly below the white stone.",
      success: "Captured. With no liberties left, the white stone is removed.",
      takeaway: "Atari means one liberty remains. Occupy that final liberty to capture.",
    },
    escape: {
      eyebrow: "Lesson 4 of 6",
      shortTitle: "Escape",
      title: "Save a stone in atari.",
      summary: "This time your black stone has only one liberty. If White fills it next, Black is captured.",
      instruction: "Extend Black onto its last liberty. The two connected stones will gain new liberties.",
      hint: "Play directly below the black stone.",
      success: "Saved. The new black stone connects to the first and gives the group more room.",
      takeaway: "When your group is in atari, extend, connect, or capture before the opponent takes its last liberty.",
    },
    connect: {
      eyebrow: "Lesson 5 of 6",
      shortTitle: "Connect",
      title: "Connected stones share liberties.",
      summary: "Stones touching along a line form one group. Diagonally separated stones remain separate groups.",
      instruction: "Place one black stone in the gap to join both stones into a single group.",
      hint: "Play exactly between the two black stones.",
      success: "Connected. All three stones now form one group and share their liberties.",
      takeaway: "Connection makes stones support each other—but the whole group is captured together if all shared liberties disappear.",
    },
    "capture-group": {
      eyebrow: "Lesson 6 of 6",
      shortTitle: "Capture a group",
      title: "A group also shares one fate.",
      summary: "The two white stones are connected. Together they have only one liberty left at the bottom edge.",
      instruction: "Find the group's final liberty and capture both white stones with one move.",
      hint: "Follow the white group downward to the only empty neighboring point.",
      success: "Two stones captured. Connected stones share liberties and are removed together.",
      takeaway: "Count liberties for the whole connected group, not for each stone separately.",
    },
  },
};

const de: ChapterOneCopy = {
  kicker: "Go durch Spielen lernen",
  title: "Verstehe Go – Zug für Zug.",
  description: "Dieses erste Kapitel vermittelt die Ideen, die du am Brett wirklich brauchst: Gebiet, Freiheiten, Atari, Schlagen, Retten und Verbinden.",
  chapterLabel: "Kapitel 1 · Freiheiten & Schlagen",
  chapterSummary: "Sechs kurze Aufgaben vom Spielziel bis zur ersten geschlagenen Gruppe.",
  progressLabel: "Fortschritt",
  lessonsLabel: "Lektionen",
  minuteLabel: "Min.",
  resetProgress: "Zurücksetzen",
  lessonNavigation: "Lektionen in Kapitel 1",
  boardLabel: "Interaktives Lernbrett",
  boardContext: "5×5-Übungsbrett",
  blackToPlay: "Spiele Schwarz",
  markLiberties: "Finde die Freiheiten",
  guidedExercise: "Auf dem Brett",
  instructionLabel: "Dein Zug",
  hint: "Hinweis zeigen",
  hideHint: "Hinweis ausblenden",
  restartLesson: "Neu starten",
  previousLesson: "Zurück",
  nextLesson: "Nächste Lektion",
  finishChapter: "9×9 ausprobieren",
  chapterComplete: "Kapitel 1 abgeschlossen",
  chapterCompleteBody: "Du kannst jetzt Freiheiten erkennen, einen Stein oder eine Gruppe schlagen, aus Atari fliehen und Steine verbinden.",
  playNine: "9×9-Partie ausprobieren",
  feedbackIdle: "Löse die Aufgabe direkt auf dem Brett.",
  feedbackWrong: "Noch nicht. Hier zählen nur Punkte, die direkt durch eine Linie verbunden sind – Diagonalen zählen nicht.",
  libertyProgress: "Richtig: {count} von 4 Freiheiten gefunden.",
  emptyPoint: "Leerer Schnittpunkt {coordinate}",
  blackStone: "Schwarzer Stein auf {coordinate}",
  whiteStone: "Weißer Stein auf {coordinate}",
  suggestedPoint: "Empfohlener Zug auf {coordinate}",
  territoryPoint: "Zu umschließender Punkt auf {coordinate}",
  libertyPoint: "Markierte Freiheit auf {coordinate}",
  takeawayLabel: "Merksatz",
  lessons: {
    goal: {
      eyebrow: "Lektion 1 von 6",
      shortTitle: "Das Spielziel",
      title: "Umschließe leeren Raum.",
      summary: "Du gewinnst Go, indem du mehr vom Brett kontrollierst als dein Gegner. Leere Punkte innerhalb deiner Grenzen werden zu Gebiet.",
      instruction: "Schwarz umschließt den goldenen Punkt bereits von drei Seiten. Schließe die letzte Lücke.",
      hint: "Spiele direkt unter dem goldenen Punkt.",
      success: "Richtig. Der leere goldene Punkt ist jetzt von Schwarz umschlossen.",
      takeaway: "Gebiet ist das Ziel. Schlagen hilft dir, eigenes Gebiet zu schützen und gegnerische Grenzen zu durchbrechen.",
    },
    liberties: {
      eyebrow: "Lektion 2 von 6",
      shortTitle: "Freiheiten",
      title: "Jeder Stein braucht Freiheiten.",
      summary: "Eine Freiheit ist ein leerer Punkt direkt über, unter, links oder rechts neben einem Stein. Diagonalen zählen nicht.",
      instruction: "Finde alle vier Freiheiten des schwarzen Steins, indem du sie nacheinander anklickst.",
      hint: "Folge den vier Linien, die vom Stein wegführen.",
      success: "Genau vier. Ein einzelner Stein in der Mitte beginnt mit vier Freiheiten.",
      takeaway: "Zähle vor jedem Kampf die Freiheiten deiner Steine und die des Gegners.",
    },
    capture: {
      eyebrow: "Lektion 3 von 6",
      shortTitle: "Schlagen",
      title: "Nimm die letzte Freiheit.",
      summary: "Der weiße Stein hat nur noch eine Freiheit. Ein Stein oder eine Gruppe mit einer Freiheit steht im Atari.",
      instruction: "Spiele Schwarz auf die letzte Freiheit von Weiß. Danach wird der weiße Stein vom Brett entfernt.",
      hint: "Der letzte freie Punkt liegt direkt unter dem weißen Stein.",
      success: "Geschlagen. Ohne Freiheiten wird der weiße Stein vom Brett entfernt.",
      takeaway: "Atari bedeutet: Eine Freiheit bleibt. Besetze diese letzte Freiheit, um zu schlagen.",
    },
    escape: {
      eyebrow: "Lektion 4 von 6",
      shortTitle: "Retten",
      title: "Rette einen Stein im Atari.",
      summary: "Diesmal hat dein schwarzer Stein nur noch eine Freiheit. Besetzt Weiß sie im nächsten Zug, wird Schwarz geschlagen.",
      instruction: "Verlängere Schwarz auf seine letzte Freiheit. Die zwei verbundenen Steine erhalten dadurch neue Freiheiten.",
      hint: "Spiele direkt unter dem schwarzen Stein.",
      success: "Gerettet. Der neue Stein verbindet sich mit dem ersten und gibt der Gruppe mehr Raum.",
      takeaway: "Steht deine Gruppe im Atari, musst du verlängern, verbinden oder selbst schlagen.",
    },
    connect: {
      eyebrow: "Lektion 5 von 6",
      shortTitle: "Verbinden",
      title: "Verbundene Steine teilen Freiheiten.",
      summary: "Steine, die sich entlang einer Linie berühren, bilden eine Gruppe. Diagonal getrennte Steine bleiben getrennte Gruppen.",
      instruction: "Setze einen schwarzen Stein in die Lücke und verbinde beide Steine zu einer Gruppe.",
      hint: "Spiele genau zwischen die beiden schwarzen Steine.",
      success: "Verbunden. Alle drei Steine bilden jetzt eine Gruppe und teilen ihre Freiheiten.",
      takeaway: "Verbindungen lassen Steine zusammenarbeiten – aber ohne gemeinsame Freiheiten wird die ganze Gruppe geschlagen.",
    },
    "capture-group": {
      eyebrow: "Lektion 6 von 6",
      shortTitle: "Gruppe schlagen",
      title: "Eine Gruppe teilt auch ihr Schicksal.",
      summary: "Die zwei weißen Steine sind verbunden. Gemeinsam haben sie nur noch eine Freiheit am unteren Rand.",
      instruction: "Finde die letzte Freiheit der Gruppe und schlage beide weißen Steine mit einem Zug.",
      hint: "Folge der weißen Gruppe nach unten bis zum einzigen freien Nachbarpunkt.",
      success: "Zwei Steine geschlagen. Verbundene Steine teilen ihre Freiheiten und werden gemeinsam entfernt.",
      takeaway: "Zähle die Freiheiten der gesamten verbundenen Gruppe, nicht die jedes einzelnen Steins.",
    },
  },
};

export function chapterOneCopy(locale: Locale): ChapterOneCopy {
  return locale === "de" ? de : en;
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

export function replaceLessonTokens(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (copy, [key, value]) => copy.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
