import type { Position } from "@/lib/game/types";
import type { Locale } from "@/lib/i18n/config";
import type { LessonStone } from "./chapterOne";

export type AdvancedChapterId = "life" | "tactics";
export type AdvancedLessonId =
  | "one-eye"
  | "two-eyes"
  | "false-eye"
  | "vital-point"
  | "make-life"
  | "seki"
  | "atari-direction"
  | "double-atari"
  | "edge-capture"
  | "ladder"
  | "ko"
  | "capturing-race";

export type AdvancedLesson = {
  id: AdvancedLessonId;
  size: number;
  stones: readonly LessonStone[];
  targets: readonly Position[];
  mode: "mark" | "play";
  toPlay: "black" | "white";
  remove?: readonly Position[];
};

export type AdvancedLessonText = {
  shortTitle: string;
  title: string;
  instruction: string;
  hint: string;
  wrong: string;
  success: string;
};

export type AdvancedChapterCopy = {
  chapterLabel: string;
  title: string;
  description: string;
  lessonNavigation: string;
  progressLabel: string;
  resetProgress: string;
  stepLabel: string;
  backToPath: string;
  lockedLesson: string;
  hint: string;
  hideHint: string;
  restartLesson: string;
  nextLesson: string;
  finishChapter: string;
  chapterComplete: string;
  chapterCompleteBody: string;
  blackToPlay: string;
  whiteToPlay: string;
  lessons: Record<AdvancedLessonId, AdvancedLessonText>;
};

export type AdvancedChapter = {
  id: AdvancedChapterId;
  storageKey: string;
  lessons: readonly AdvancedLesson[];
};

const black = (x: number, y: number): LessonStone => ({ x, y, color: "black" });
const white = (x: number, y: number): LessonStone => ({ x, y, color: "white" });
const point = (x: number, y: number): Position => ({ x, y });

const twoEyeShape = [
  black(0, 1), black(1, 1), black(2, 1), black(3, 1), black(4, 1),
  black(0, 2), black(2, 2), black(4, 2),
  black(0, 3), black(1, 3), black(2, 3), black(3, 3), black(4, 3),
] as const;

const straightThreeBoundary = [
  black(0, 1), black(1, 1), black(2, 1), black(3, 1), black(4, 1),
  black(0, 2), black(4, 2),
  black(0, 3), black(1, 3), black(2, 3), black(3, 3), black(4, 3),
] as const;

export const LIFE_LESSON_IDS = ["one-eye", "two-eyes", "false-eye", "vital-point", "make-life", "seki"] as const;
export const TACTICS_LESSON_IDS = ["atari-direction", "double-atari", "edge-capture", "ladder", "ko", "capturing-race"] as const;

export const ADVANCED_CHAPTERS: Record<AdvancedChapterId, AdvancedChapter> = {
  life: {
    id: "life",
    storageKey: "gostone.learn.chapter-two.v1",
    lessons: [
      {
        id: "one-eye",
        size: 5,
        stones: [black(1, 0), black(0, 1), black(1, 1)],
        targets: [point(0, 0)],
        mode: "mark",
        toPlay: "black",
      },
      {
        id: "two-eyes",
        size: 5,
        stones: twoEyeShape,
        targets: [point(1, 2), point(3, 2)],
        mode: "mark",
        toPlay: "black",
      },
      {
        id: "false-eye",
        size: 5,
        stones: [
          black(2, 1), black(1, 2), black(3, 2), black(2, 3),
          white(2, 0), white(1, 1), white(3, 1),
        ],
        targets: [point(2, 2)],
        mode: "mark",
        toPlay: "white",
      },
      {
        id: "vital-point",
        size: 5,
        stones: straightThreeBoundary,
        targets: [point(2, 2)],
        mode: "play",
        toPlay: "white",
      },
      {
        id: "make-life",
        size: 5,
        stones: straightThreeBoundary,
        targets: [point(2, 2)],
        mode: "play",
        toPlay: "black",
      },
      {
        id: "seki",
        size: 5,
        stones: [
          black(0, 0), black(0, 1),
          white(2, 0), white(2, 1),
          white(0, 2),
          black(3, 0), black(3, 1), black(2, 2),
        ],
        targets: [point(1, 0), point(1, 1)],
        mode: "mark",
        toPlay: "black",
      },
    ],
  },
  tactics: {
    id: "tactics",
    storageKey: "gostone.learn.chapter-three.v1",
    lessons: [
      {
        id: "atari-direction",
        size: 5,
        stones: [white(2, 2), white(2, 3), black(1, 2), black(1, 3), black(2, 1), black(3, 3)],
        targets: [point(3, 2)],
        mode: "play",
        toPlay: "black",
      },
      {
        id: "double-atari",
        size: 5,
        stones: [white(1, 2), white(3, 2), black(1, 1), black(1, 3), black(3, 1), black(3, 3)],
        targets: [point(2, 2)],
        mode: "play",
        toPlay: "black",
      },
      {
        id: "edge-capture",
        size: 5,
        stones: [white(0, 2), white(0, 3), black(0, 1), black(1, 2), black(1, 3)],
        targets: [point(0, 4)],
        mode: "play",
        toPlay: "black",
        remove: [point(0, 2), point(0, 3)],
      },
      {
        id: "ladder",
        size: 7,
        stones: [white(1, 1), black(0, 1), black(1, 0)],
        targets: [point(1, 2)],
        mode: "play",
        toPlay: "black",
      },
      {
        id: "ko",
        size: 5,
        stones: [
          white(2, 2), white(1, 3), white(3, 3), white(2, 4),
          black(2, 1), black(1, 2), black(3, 2),
        ],
        targets: [point(2, 3)],
        mode: "play",
        toPlay: "black",
        remove: [point(2, 2)],
      },
      {
        id: "capturing-race",
        size: 5,
        stones: [
          white(2, 2), white(2, 3),
          black(2, 1), black(1, 2), black(1, 3), black(2, 4), black(3, 3),
        ],
        targets: [point(3, 2)],
        mode: "play",
        toPlay: "black",
        remove: [point(2, 2), point(2, 3)],
      },
    ],
  },
};

const enLessons: Record<AdvancedLessonId, AdvancedLessonText> = {
  "one-eye": {
    shortTitle: "One eye",
    title: "Recognise a real eye.",
    instruction: "Tap the eye point inside the connected black group.",
    hint: "Look in the top-left corner. Both neighbouring points and the diagonal belong to Black.",
    wrong: "That point is not the enclosed eye.",
    success: "Correct. It is a real eye, but one eye alone does not make a group unconditionally alive.",
  },
  "two-eyes": {
    shortTitle: "Two eyes",
    title: "Find both eyes.",
    instruction: "Mark the two separate empty regions inside Black's group.",
    hint: "The black divider keeps the two empty points separate.",
    wrong: "Only the two enclosed, separated points are eyes.",
    success: "Exactly. An opponent cannot fill either eye first without self-capture, so this group is alive.",
  },
  "false-eye": {
    shortTitle: "False eye",
    title: "Spot the false eye.",
    instruction: "Tap the point that looks enclosed but can be entered after the top black stone is captured.",
    hint: "The top black stone has only the apparent eye as a liberty.",
    wrong: "Check which surrounding stone is already in atari.",
    success: "Right. White can play there and capture the top stone, so this is not a secure eye.",
  },
  "vital-point": {
    shortTitle: "Vital point",
    title: "Take the vital point.",
    instruction: "White to play: occupy the middle of Black's straight three-point eye space.",
    hint: "Split the inner space into two parts before Black does.",
    wrong: "The middle point controls the whole eye shape.",
    success: "Correct. The centre is the vital point: Black can no longer divide the space into two eyes.",
  },
  "make-life": {
    shortTitle: "Make life",
    title: "Create two eyes.",
    instruction: "Black to play: divide the straight three-point space into two eyes.",
    hint: "Play in the middle of the three empty points.",
    wrong: "Only the centre separates the space into two eyes at once.",
    success: "Alive. The centre stone creates two separate one-point eyes.",
  },
  seki: {
    shortTitle: "Seki",
    title: "Recognise mutual life.",
    instruction: "Mark the two shared liberties that neither side can safely fill.",
    hint: "They lie directly between the black and white groups.",
    wrong: "Look only at the liberties shared by both groups.",
    success: "Correct. Filling the shared liberties first would let the opponent capture; both groups live in seki.",
  },
  "atari-direction": {
    shortTitle: "Atari direction",
    title: "Drive the group to the edge.",
    instruction: "Put the white chain in atari from the right side.",
    hint: "Leave White's only liberty on the bottom edge.",
    wrong: "Attack from the right, not from below.",
    success: "Good. The direction of atari matters: White is forced toward the edge.",
  },
  "double-atari": {
    shortTitle: "Double atari",
    title: "Attack two groups at once.",
    instruction: "Find the move that leaves both separate white stones with one liberty.",
    hint: "One point touches both white stones.",
    wrong: "Choose the point between the two white stones.",
    success: "Double atari. White can save only one of the two separate stones on the next move.",
  },
  "edge-capture": {
    shortTitle: "Edge capture",
    title: "Use the edge as a wall.",
    instruction: "Fill the white chain's last liberty on the lower edge.",
    hint: "Stones on the edge have fewer liberties.",
    wrong: "The last liberty is directly below the white chain.",
    success: "Captured. The board edge already blocks one side, so fewer stones are needed.",
  },
  ladder: {
    shortTitle: "Ladder",
    title: "Start a ladder.",
    instruction: "Play the atari from below to begin the zigzag chase.",
    hint: "Keep White to one liberty and chase at the head of the chain.",
    wrong: "Begin with the atari directly below White.",
    success: "That starts the ladder. It works only when no white ladder breaker lies in its path.",
  },
  ko: {
    shortTitle: "Ko",
    title: "Create a ko.",
    instruction: "Capture the single white stone. Notice that immediate recapture would repeat the position.",
    hint: "Play on White's only liberty below it.",
    wrong: "Capture the central white stone from below.",
    success: "Ko. White may not recapture immediately and must first play elsewhere.",
  },
  "capturing-race": {
    shortTitle: "Capturing race",
    title: "Win the capturing race.",
    instruction: "Fill the white chain's last outside liberty before White can escape.",
    hint: "Count the liberties of the whole white chain, not each stone separately.",
    wrong: "The last liberty is on the right of the upper white stone.",
    success: "Won. In a capturing race, count group liberties and fill outside liberties first.",
  },
};

const deLessons: Record<AdvancedLessonId, AdvancedLessonText> = {
  "one-eye": {
    shortTitle: "Ein Auge",
    title: "Erkenne ein echtes Auge.",
    instruction: "Tippe auf den Augenpunkt innerhalb der verbundenen schwarzen Gruppe.",
    hint: "Schau in die linke obere Ecke. Beide Nachbarpunkte und die Diagonale gehören Schwarz.",
    wrong: "Dieser Punkt ist nicht das umschlossene Auge.",
    success: "Richtig. Es ist ein echtes Auge – aber ein Auge allein macht eine Gruppe noch nicht sicher lebendig.",
  },
  "two-eyes": {
    shortTitle: "Zwei Augen",
    title: "Finde beide Augen.",
    instruction: "Markiere die zwei getrennten leeren Bereiche innerhalb der schwarzen Gruppe.",
    hint: "Der schwarze Trennstein hält die beiden leeren Punkte auseinander.",
    wrong: "Nur die beiden umschlossenen, getrennten Punkte sind Augen.",
    success: "Genau. Der Gegner kann keines der Augen zuerst füllen, ohne sich selbst zu schlagen – die Gruppe lebt.",
  },
  "false-eye": {
    shortTitle: "Falsches Auge",
    title: "Erkenne das falsche Auge.",
    instruction: "Tippe auf den Punkt, der umschlossen aussieht, aber nach dem Schlag des oberen Steins betreten werden kann.",
    hint: "Der obere schwarze Stein hat nur das scheinbare Auge als Freiheit.",
    wrong: "Prüfe, welcher umgebende Stein bereits im Atari steht.",
    success: "Richtig. Weiß kann dort spielen und den oberen Stein schlagen – deshalb ist es kein sicheres Auge.",
  },
  "vital-point": {
    shortTitle: "Vitaler Punkt",
    title: "Besetze den vitalen Punkt.",
    instruction: "Weiß am Zug: Spiele in die Mitte des geraden Dreierraums von Schwarz.",
    hint: "Teile den Innenraum, bevor Schwarz es tut.",
    wrong: "Der mittlere Punkt kontrolliert die gesamte Augenform.",
    success: "Richtig. Nach dem Zug in die Mitte kann Schwarz den Raum nicht mehr in zwei Augen teilen.",
  },
  "make-life": {
    shortTitle: "Leben machen",
    title: "Bilde zwei Augen.",
    instruction: "Schwarz am Zug: Teile den geraden Dreierraum in zwei Augen.",
    hint: "Spiele in die Mitte der drei leeren Punkte.",
    wrong: "Nur die Mitte trennt den Raum sofort in zwei Augen.",
    success: "Lebendig. Der mittlere Stein erzeugt zwei getrennte Einpunktaugen.",
  },
  seki: {
    shortTitle: "Seki",
    title: "Erkenne gegenseitiges Leben.",
    instruction: "Markiere die zwei gemeinsamen Freiheiten, die keine Seite sicher füllen kann.",
    hint: "Sie liegen direkt zwischen der schwarzen und weißen Gruppe.",
    wrong: "Suche nur die Freiheiten, die beide Gruppen gemeinsam haben.",
    success: "Richtig. Wer die gemeinsamen Freiheiten zuerst füllt, wird geschlagen – beide Gruppen leben im Seki.",
  },
  "atari-direction": {
    shortTitle: "Atari-Richtung",
    title: "Treibe die Gruppe zum Rand.",
    instruction: "Setze die weiße Kette von rechts ins Atari.",
    hint: "Lass Weiß nur die Freiheit am unteren Rand.",
    wrong: "Greife von rechts an, nicht von unten.",
    success: "Gut. Die Atari-Richtung ist wichtig: Weiß wird zum Rand gedrängt.",
  },
  "double-atari": {
    shortTitle: "Doppelatari",
    title: "Greife zwei Gruppen zugleich an.",
    instruction: "Finde den Zug, der beide getrennten weißen Steine auf eine Freiheit setzt.",
    hint: "Ein Punkt berührt beide weißen Steine.",
    wrong: "Wähle den Punkt zwischen den beiden weißen Steinen.",
    success: "Doppelatari. Weiß kann im nächsten Zug nur einen der getrennten Steine retten.",
  },
  "edge-capture": {
    shortTitle: "Am Rand schlagen",
    title: "Nutze den Rand als Wand.",
    instruction: "Fülle die letzte Freiheit der weißen Kette am unteren Rand.",
    hint: "Steine am Rand besitzen weniger Freiheiten.",
    wrong: "Die letzte Freiheit liegt direkt unter der weißen Kette.",
    success: "Geschlagen. Der Brettrand blockiert bereits eine Seite, daher werden weniger Steine benötigt.",
  },
  ladder: {
    shortTitle: "Leiter",
    title: "Beginne eine Leiter.",
    instruction: "Spiele das Atari von unten und starte die Zickzack-Verfolgung.",
    hint: "Halte Weiß bei einer Freiheit und jage am Kopf der Kette weiter.",
    wrong: "Beginne mit dem Atari direkt unter Weiß.",
    success: "Damit beginnt die Leiter. Sie funktioniert nur, wenn kein weißer Leiterbrecher im Weg liegt.",
  },
  ko: {
    shortTitle: "Ko",
    title: "Erzeuge ein Ko.",
    instruction: "Schlage den einzelnen weißen Stein. Ein sofortiger Rückschlag würde die Stellung wiederholen.",
    hint: "Spiele unter Weiß auf seine letzte Freiheit.",
    wrong: "Schlage den mittleren weißen Stein von unten.",
    success: "Ko. Weiß darf nicht sofort zurückschlagen und muss zuerst woanders spielen.",
  },
  "capturing-race": {
    shortTitle: "Fangrennen",
    title: "Gewinne das Fangrennen.",
    instruction: "Fülle die letzte äußere Freiheit der weißen Kette, bevor Weiß entkommt.",
    hint: "Zähle die Freiheiten der ganzen weißen Kette, nicht die jedes einzelnen Steins.",
    wrong: "Die letzte Freiheit liegt rechts vom oberen weißen Stein.",
    success: "Gewonnen. Im Fangrennen zählen die Gruppenfreiheiten; äußere Freiheiten werden zuerst gefüllt.",
  },
};

export function advancedChapterCopy(id: AdvancedChapterId, locale: Locale): AdvancedChapterCopy {
  const german = locale === "de";
  return {
    chapterLabel: german ? (id === "life" ? "Kapitel 2" : "Kapitel 3") : (id === "life" ? "Chapter 2" : "Chapter 3"),
    title: german ? (id === "life" ? "Leben und Tod." : "Fangen und kämpfen.") : (id === "life" ? "Life and death." : "Capture and fight."),
    description: german
      ? (id === "life" ? "Echte Augen, falsche Augen, vitale Punkte und Seki." : "Atari-Richtung, Leiter, Ko und Fangrennen.")
      : (id === "life" ? "Real eyes, false eyes, vital points, and seki." : "Atari direction, ladders, ko, and capturing races."),
    lessonNavigation: german ? "Lektionen dieses Kapitels" : "Lessons in this chapter",
    progressLabel: german ? "Fortschritt" : "Progress",
    resetProgress: german ? "Kapitel zurücksetzen" : "Reset chapter",
    stepLabel: german ? "Lektion" : "Lesson",
    backToPath: german ? "Zurück zum Pfad" : "Back to path",
    lockedLesson: german ? "Schließe zuerst die vorherige Lektion ab" : "Complete the previous lesson first",
    hint: german ? "Hinweis zeigen" : "Show hint",
    hideHint: german ? "Hinweis ausblenden" : "Hide hint",
    restartLesson: german ? "Neu starten" : "Restart",
    nextLesson: german ? "Nächste Lektion" : "Next lesson",
    finishChapter: german ? "Kapitel abschließen" : "Finish chapter",
    chapterComplete: german ? "Kapitel abgeschlossen" : "Chapter complete",
    chapterCompleteBody: german
      ? (id === "life" ? "Du kannst lebende, tote und gegenseitig lebende Gruppen unterscheiden." : "Du kennst jetzt die wichtigsten Fangmuster für deine ersten Partien.")
      : (id === "life" ? "You can distinguish living, dead, and mutually alive groups." : "You now know the key capturing patterns for your first games."),
    blackToPlay: german ? "Schwarz am Zug" : "Black to play",
    whiteToPlay: german ? "Weiß am Zug" : "White to play",
    lessons: german ? deLessons : enLessons,
  };
}
