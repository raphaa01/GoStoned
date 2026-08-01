import type { Locale } from "@/lib/i18n/config";
import type { Position, Stone } from "@/lib/game/types";

export const CHAPTER_ONE_LESSON_IDS = [
  "goal",
  "turns",
  "intersections",
  "stones-stay",
  "surround",
  "board-regions",
] as const;

export type ChapterOneLessonId = (typeof CHAPTER_ONE_LESSON_IDS)[number];

export type LessonStone = Position & { color: Stone };

export type LessonDefinition = {
  id: ChapterOneLessonId;
  kind: ChapterOneLessonId;
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
  progressLabel: string;
  completedLabel: string;
  lessonsLabel: string;
  minuteLabel: string;
  resetProgress: string;
  lessonNavigation: string;
  boardLabel: string;
  boardContext: string;
  blackToPlay: string;
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
  feedbackProgress: string;
  turnProgress: string;
  regionProgress: string;
  regionCorner: string;
  regionSide: string;
  regionCenter: string;
  occupiedPoint: string;
  lessonDone: string;
  emptyPoint: string;
  blackStone: string;
  whiteStone: string;
  suggestedPoint: string;
  territoryPoint: string;
  takeawayLabel: string;
  lessons: Record<ChapterOneLessonId, LessonText>;
};

export const CHAPTER_ONE_LESSONS: readonly LessonDefinition[] = [
  { id: "goal", kind: "goal", minutes: 3 },
  { id: "turns", kind: "turns", minutes: 3 },
  { id: "intersections", kind: "intersections", minutes: 2 },
  { id: "stones-stay", kind: "stones-stay", minutes: 2 },
  { id: "surround", kind: "surround", minutes: 3 },
  { id: "board-regions", kind: "board-regions", minutes: 4 },
] as const;

export const LESSON_BOARD_SIZE = 7;

export const GOAL_POSITION = { x: 2, y: 2 } as const;
export const GOAL_CLOSING_MOVE = { x: 2, y: 3 } as const;
export const INTERSECTION_TARGET = { x: 3, y: 3 } as const;
export const SURROUND_DISTRACTOR = { x: 4, y: 4 } as const;

export const LESSON_SETUPS: Record<ChapterOneLessonId, readonly LessonStone[]> = {
  goal: [
    { x: 2, y: 1, color: "black" },
    { x: 1, y: 2, color: "black" },
    { x: 3, y: 2, color: "black" },
    { x: 5, y: 1, color: "white" },
    { x: 5, y: 2, color: "white" },
  ],
  turns: [],
  intersections: [],
  "stones-stay": [{ x: 2, y: 3, color: "black" }],
  surround: [
    { x: 2, y: 1, color: "black" },
    { x: 1, y: 2, color: "black" },
    { x: 3, y: 2, color: "black" },
    { x: 5, y: 4, color: "white" },
  ],
  "board-regions": [],
};

export const REGION_EXERCISES = [
  {
    id: "corner",
    target: { x: 0, y: 0 },
    required: [{ x: 1, y: 0 }, { x: 0, y: 1 }],
  },
  {
    id: "side",
    target: { x: 3, y: 0 },
    required: [{ x: 2, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 1 }],
  },
  {
    id: "center",
    target: { x: 3, y: 4 },
    required: [{ x: 2, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 3 }, { x: 3, y: 5 }],
  },
] as const;

const en: ChapterOneCopy = {
  kicker: "Interactive learning path",
  title: "Your first six Go lessons.",
  description: "Learn the objective, the board, and the rhythm of a turn by placing stones yourself. Every exercise gives immediate feedback and leaves you with one clear idea.",
  chapterLabel: "Chapter 1 · What is Go?",
  progressLabel: "Chapter progress",
  completedLabel: "completed",
  lessonsLabel: "lessons",
  minuteLabel: "min",
  resetProgress: "Reset progress",
  lessonNavigation: "Lessons in chapter 1",
  boardLabel: "Interactive teaching board",
  boardContext: "7×7 teaching view · the same ideas apply to every board size",
  blackToPlay: "You play Black",
  guidedExercise: "Guided exercise",
  instructionLabel: "Your task",
  hint: "Show hint",
  hideHint: "Hide hint",
  restartLesson: "Restart lesson",
  previousLesson: "Previous",
  nextLesson: "Next lesson",
  finishChapter: "Try 9×9",
  chapterComplete: "Chapter 1 complete",
  chapterCompleteBody: "You now know what Go is about, where stones are played, and why the corners are efficient. Next comes liberties and capturing.",
  playNine: "Try a 9×9 game",
  feedbackIdle: "Place a stone on the board to try the exercise.",
  feedbackWrong: "That move is legal, but it does not solve this task yet. Look again at the marked area.",
  feedbackProgress: "Good. Keep going—the stones already placed stay on the board.",
  turnProgress: "Black moves placed: {count} of 3. White answers automatically.",
  regionProgress: "{region}: {count} of {total} boundary stones placed.",
  regionCorner: "Corner",
  regionSide: "Side",
  regionCenter: "Centre",
  occupiedPoint: "That intersection is already occupied.",
  lessonDone: "Exercise solved.",
  emptyPoint: "Empty intersection {coordinate}",
  blackStone: "Black stone on {coordinate}",
  whiteStone: "White stone on {coordinate}",
  suggestedPoint: "Suggested intersection {coordinate}",
  territoryPoint: "Point to surround at {coordinate}",
  takeawayLabel: "Remember",
  lessons: {
    goal: {
      eyebrow: "Lesson 1 of 6",
      shortTitle: "The objective",
      title: "Surround more space than your opponent.",
      summary: "Go is a game about controlling the board. Empty intersections fully enclosed by your stones become your territory.",
      instruction: "Black almost surrounds the golden point. Place the one stone that closes the boundary.",
      hint: "The missing boundary is directly below the golden point.",
      success: "Exactly. The golden point is now enclosed by Black on all four open sides.",
      takeaway: "The objective is territory. Capturing stones will later help you build and protect it.",
    },
    turns: {
      eyebrow: "Lesson 2 of 6",
      shortTitle: "Black and White",
      title: "Black starts, then both players alternate.",
      summary: "One player uses Black, the other White. Each turn adds exactly one new stone to an empty intersection.",
      instruction: "Place three Black stones wherever you like. White will answer after each move.",
      hint: "There is no wrong empty point here. Watch how the colours alternate.",
      success: "Three turns complete: Black, White, Black, White, Black, White.",
      takeaway: "Black always makes the first move in an even game, and turns alternate after that.",
    },
    intersections: {
      eyebrow: "Lesson 3 of 6",
      shortTitle: "Intersections",
      title: "Stones sit where two lines cross.",
      summary: "The spaces between the lines are not playable squares. Every move belongs on an intersection.",
      instruction: "Place a Black stone on the marked intersection in the centre.",
      hint: "Tap the pulsing point where the horizontal and vertical lines meet.",
      success: "Correct. The stone is centred directly on the crossing of two lines.",
      takeaway: "In Go, coordinates name line intersections—not the spaces between them.",
    },
    "stones-stay": {
      eyebrow: "Lesson 4 of 6",
      shortTitle: "Stones stay",
      title: "A played stone does not move again.",
      summary: "Unlike many board games, Go has no moving pieces. Your position grows by adding new stones.",
      instruction: "Add two more Black stones. Notice that the first stone remains exactly where it was.",
      hint: "Choose any two empty intersections. You are building a position, not moving the first stone.",
      success: "Now three stones remain on the board. They only leave later if the opponent captures them.",
      takeaway: "Every turn adds a stone; it never slides or jumps to a different point.",
    },
    surround: {
      eyebrow: "Lesson 5 of 6",
      shortTitle: "Surround, don’t chase",
      title: "Territory matters more than chasing every stone.",
      summary: "The nearby White stone may look tempting, but a move that completes a boundary creates value immediately.",
      instruction: "Choose the move that closes Black's territory around the golden point.",
      hint: "Ignore the distant White stone. Fill the gap directly below the golden point.",
      success: "Good choice. Black completed territory instead of spending a move on a distant chase.",
      takeaway: "Capturing is useful, but the winner is decided by controlled space—not by who chases the most stones.",
    },
    "board-regions": {
      eyebrow: "Lesson 6 of 6",
      shortTitle: "Corner, side, centre",
      title: "The edge of the board can help you surround.",
      summary: "A corner already supplies two boundaries, a side supplies one, and the centre supplies none.",
      instruction: "Surround the marked point first in the corner, then on the side, and finally in the centre.",
      hint: "Place Black stones only on the open lines directly next to the golden point.",
      success: "You used 2 stones in the corner, 3 on the side, and 4 in the centre. That is why early Go usually begins near the corners.",
      takeaway: "Corner first, then sides, then centre is a useful opening principle—not an absolute rule.",
    },
  },
};

const de: ChapterOneCopy = {
  kicker: "Interaktiver Lernpfad",
  title: "Deine ersten sechs Go-Lektionen.",
  description: "Lerne Ziel, Brett und Zugrhythmus, indem du selbst Steine setzt. Jede Aufgabe reagiert sofort und vermittelt genau eine klare Idee.",
  chapterLabel: "Kapitel 1 · Was ist Go?",
  progressLabel: "Kapitelfortschritt",
  completedLabel: "abgeschlossen",
  lessonsLabel: "Lektionen",
  minuteLabel: "Min.",
  resetProgress: "Fortschritt zurücksetzen",
  lessonNavigation: "Lektionen in Kapitel 1",
  boardLabel: "Interaktives Lernbrett",
  boardContext: "7×7-Lernausschnitt · die Ideen gelten auf jeder Brettgröße",
  blackToPlay: "Du spielst Schwarz",
  guidedExercise: "Geführte Aufgabe",
  instructionLabel: "Deine Aufgabe",
  hint: "Hinweis zeigen",
  hideHint: "Hinweis ausblenden",
  restartLesson: "Lektion neu starten",
  previousLesson: "Zurück",
  nextLesson: "Nächste Lektion",
  finishChapter: "9×9 ausprobieren",
  chapterComplete: "Kapitel 1 abgeschlossen",
  chapterCompleteBody: "Du kennst jetzt das Ziel von Go, weißt, wo Steine gesetzt werden, und verstehst, warum die Ecken effizient sind. Als Nächstes kommen Freiheiten und Gefangennahmen.",
  playNine: "9×9-Partie ausprobieren",
  feedbackIdle: "Setze einen Stein auf das Brett, um die Aufgabe zu lösen.",
  feedbackWrong: "Dieser Zug wäre möglich, löst die Aufgabe aber noch nicht. Sieh dir den markierten Bereich noch einmal an.",
  feedbackProgress: "Gut. Mach weiter – die bereits gesetzten Steine bleiben auf dem Brett.",
  turnProgress: "Schwarze Züge: {count} von 3. Weiß antwortet automatisch.",
  regionProgress: "{region}: {count} von {total} Begrenzungssteinen gesetzt.",
  regionCorner: "Ecke",
  regionSide: "Rand",
  regionCenter: "Mitte",
  occupiedPoint: "Dieser Schnittpunkt ist bereits besetzt.",
  lessonDone: "Aufgabe gelöst.",
  emptyPoint: "Leerer Schnittpunkt {coordinate}",
  blackStone: "Schwarzer Stein auf {coordinate}",
  whiteStone: "Weißer Stein auf {coordinate}",
  suggestedPoint: "Empfohlener Schnittpunkt {coordinate}",
  territoryPoint: "Zu umschließender Punkt auf {coordinate}",
  takeawayLabel: "Merksatz",
  lessons: {
    goal: {
      eyebrow: "Lektion 1 von 6",
      shortTitle: "Das Spielziel",
      title: "Umschließe mehr Raum als dein Gegner.",
      summary: "Bei Go geht es darum, das Brett zu kontrollieren. Leere Schnittpunkte, die vollständig von deinen Steinen umschlossen sind, werden zu deinem Gebiet.",
      instruction: "Schwarz umschließt den goldenen Punkt fast. Setze den einen Stein, der die Grenze schließt.",
      hint: "Die fehlende Begrenzung liegt direkt unter dem goldenen Punkt.",
      success: "Genau. Der goldene Punkt ist nun auf allen offenen Seiten von Schwarz umschlossen.",
      takeaway: "Das Ziel ist Gebiet. Gefangennahmen helfen dir später, dieses Gebiet aufzubauen und zu schützen.",
    },
    turns: {
      eyebrow: "Lektion 2 von 6",
      shortTitle: "Schwarz und Weiß",
      title: "Schwarz beginnt, danach wird abgewechselt.",
      summary: "Ein Spieler setzt Schwarz, der andere Weiß. In jedem Zug kommt genau ein neuer Stein auf einen freien Schnittpunkt.",
      instruction: "Setze drei schwarze Steine an beliebige freie Stellen. Weiß antwortet nach jedem Zug.",
      hint: "Hier gibt es keinen falschen freien Punkt. Beobachte, wie sich die Farben abwechseln.",
      success: "Drei Zugpaare sind vollständig: Schwarz, Weiß, Schwarz, Weiß, Schwarz, Weiß.",
      takeaway: "In einer ausgeglichenen Partie macht Schwarz immer den ersten Zug; danach wechseln sich beide Spieler ab.",
    },
    intersections: {
      eyebrow: "Lektion 3 von 6",
      shortTitle: "Schnittpunkte",
      title: "Steine liegen dort, wo sich zwei Linien kreuzen.",
      summary: "Die Flächen zwischen den Linien sind keine Spielfelder. Jeder Zug gehört auf einen Schnittpunkt.",
      instruction: "Setze einen schwarzen Stein auf den markierten Schnittpunkt in der Mitte.",
      hint: "Tippe auf den pulsierenden Punkt, an dem sich die waagerechte und senkrechte Linie treffen.",
      success: "Richtig. Der Stein liegt genau auf der Kreuzung zweier Linien.",
      takeaway: "Go-Koordinaten bezeichnen Schnittpunkte der Linien – nicht die Flächen dazwischen.",
    },
    "stones-stay": {
      eyebrow: "Lektion 4 von 6",
      shortTitle: "Steine bleiben liegen",
      title: "Ein gesetzter Stein wird nicht mehr bewegt.",
      summary: "Anders als bei vielen Brettspielen gibt es bei Go keine beweglichen Figuren. Deine Stellung wächst, indem du neue Steine hinzufügst.",
      instruction: "Setze zwei weitere schwarze Steine. Achte darauf, dass der erste Stein genau an seinem Platz bleibt.",
      hint: "Wähle zwei beliebige freie Schnittpunkte. Du baust eine Stellung auf, statt den ersten Stein zu bewegen.",
      success: "Jetzt bleiben drei Steine auf dem Brett. Sie verschwinden später nur, wenn der Gegner sie gefangen nimmt.",
      takeaway: "Jeder Zug fügt einen Stein hinzu; er rutscht oder springt niemals auf einen anderen Punkt.",
    },
    surround: {
      eyebrow: "Lektion 5 von 6",
      shortTitle: "Umschließen statt jagen",
      title: "Gebiet ist wichtiger als jeden Stein zu verfolgen.",
      summary: "Der nahe weiße Stein wirkt vielleicht verlockend. Ein Zug, der sofort eine Grenze schließt, schafft jedoch unmittelbar Wert.",
      instruction: "Wähle den Zug, der das schwarze Gebiet um den goldenen Punkt schließt.",
      hint: "Ignoriere den entfernten weißen Stein. Schließe die Lücke direkt unter dem goldenen Punkt.",
      success: "Gute Wahl. Schwarz hat Gebiet vollendet, statt einen Zug für eine entfernte Verfolgung auszugeben.",
      takeaway: "Gefangennahmen sind nützlich, aber kontrollierter Raum entscheidet die Partie – nicht die Zahl der verfolgten Steine.",
    },
    "board-regions": {
      eyebrow: "Lektion 6 von 6",
      shortTitle: "Ecke, Rand und Mitte",
      title: "Der Brettrand hilft dir beim Umschließen.",
      summary: "Eine Ecke liefert bereits zwei Begrenzungen, ein Rand eine und die Mitte keine.",
      instruction: "Umschließe den markierten Punkt zuerst in der Ecke, dann am Rand und zuletzt in der Mitte.",
      hint: "Setze schwarze Steine nur auf die offenen Linien direkt neben dem goldenen Punkt.",
      success: "Du brauchtest 2 Steine in der Ecke, 3 am Rand und 4 in der Mitte. Deshalb beginnen Go-Partien meist in der Nähe der Ecken.",
      takeaway: "Ecken zuerst, dann Ränder, dann die Mitte ist ein hilfreiches Eröffnungsprinzip – keine starre Regel.",
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
