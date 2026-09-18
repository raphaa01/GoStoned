import { toGtpCoordinate } from "@/lib/analysis/coordinates";
import type { Board } from "@/lib/game/types";
import type { LocalizedText } from "@/lib/i18n/config";
import { dailyPuzzleForDate } from "./dailyCatalog";
import type {
  PuzzleCategory,
  PuzzleDifficulty,
  PuzzleVariation,
} from "./types";

export const STATIC_DAILY_ENGINE_VERSION = "static-daily-v1";

const SOLUTION_EXPLANATIONS: Record<PuzzleCategory, LocalizedText> = {
  life_and_death: {
    en: "This is the vital point that decides the local group's eye space.",
    de: "Dies ist der vitale Punkt, der über den Augenraum der lokalen Gruppe entscheidet.",
    fr: "C'est le point vital qui détermine l'espace d'yeux du groupe local.",
    es: "Este es el punto vital que decide el espacio de ojos del grupo local.",
    zh: "这是决定局部棋块眼位的要点。",
    ja: "これは局所の石の眼形を決める急所です。",
    ko: "이곳은 국지적인 돌의 눈 모양을 결정하는 급소입니다.",
    ky: "Бул жергиликтүү топтун көз мейкиндигин чечкен маанилүү чекит.",
  },
  tesuji: {
    en: "This is the tactical vital point that starts the forcing local sequence.",
    de: "Dies ist der taktische Schlüsselpunkt, der die zwingende lokale Folge beginnt.",
    fr: "C'est le point tactique vital qui lance la séquence locale forcée.",
    es: "Este es el punto táctico vital que inicia la secuencia local forzada.",
    zh: "这是启动局部强制手段的战术要点。",
    ja: "これは局所の強制手順を始める手筋の急所です。",
    ko: "이곳은 국지적인 강제 수순을 시작하는 전술의 급소입니다.",
    ky: "Бул жергиликтүү мажбур жүрүштөрдү баштаган тактикалык маанилүү чекит.",
  },
  capturing_race: {
    en: "This move takes the key liberty in the local capturing race.",
    de: "Dieser Zug nimmt die entscheidende Freiheit im lokalen Fangrennen.",
    fr: "Ce coup prend la liberté décisive dans la course de capture locale.",
    es: "Esta jugada toma la libertad decisiva en la carrera de captura local.",
    zh: "这手棋抢到了局部对杀的关键气。",
    ja: "この手は局所の攻め合いで重要なダメを取ります。",
    ko: "이 수는 국지적인 수상전에서 핵심 활로를 차지합니다.",
    ky: "Бул жүрүш жергиликтүү дем жарышындагы негизги демди ээлейт.",
  },
  endgame: {
    en: "This is the largest forcing move in the local endgame position.",
    de: "Dies ist der größte zwingende Zug in dieser lokalen Endspielstellung.",
    fr: "C'est le plus grand coup forcé dans cette position de fin de partie locale.",
    es: "Esta es la jugada forzada más grande en esta posición local de final.",
    zh: "这是这个局部官子中最大的强制手段。",
    ja: "これはこの局所的なヨセで最も大きい強制手です。",
    ko: "이곳은 국지적인 끝내기에서 가장 큰 강제 수입니다.",
    ky: "Бул жергиликтүү эндшпилдеги эң чоң мажбур жүрүш.",
  },
};

const RETRY_EXPLANATIONS: Record<PuzzleCategory, LocalizedText> = {
  life_and_death: {
    en: "That move misses the vital point of the local eye space.",
    de: "Dieser Zug verpasst den vitalen Punkt des lokalen Augenraums.",
    fr: "Ce coup manque le point vital de l'espace d'yeux local.",
    es: "Esa jugada pierde el punto vital del espacio de ojos local.",
    zh: "这手棋错过了局部眼位的要点。",
    ja: "この手は局所の眼形の急所を逃しています。",
    ko: "이 수는 국지적인 눈 모양의 급소를 놓칩니다.",
    ky: "Бул жүрүш жергиликтүү көз мейкиндигинин маанилүү чекитин өткөрүп жиберет.",
  },
  tesuji: {
    en: "That move loses the local tactical timing.",
    de: "Dieser Zug verliert das lokale taktische Timing.",
    fr: "Ce coup perd le bon timing tactique local.",
    es: "Esa jugada pierde el momento táctico local.",
    zh: "这手棋错过了局部战术时机。",
    ja: "この手では局所の手筋の機を逃します。",
    ko: "이 수는 국지적인 전술 타이밍을 놓칩니다.",
    ky: "Бул жүрүш жергиликтүү тактикалык учурду жоготот.",
  },
  capturing_race: {
    en: "That move loses a tempo in the local liberty race.",
    de: "Dieser Zug verliert im lokalen Freiheitsrennen ein Tempo.",
    fr: "Ce coup perd un tempo dans la course aux libertés locale.",
    es: "Esa jugada pierde un tiempo en la carrera local de libertades.",
    zh: "这手棋在局部对杀中慢了一气。",
    ja: "この手では局所の攻め合いで一手遅れます。",
    ko: "이 수는 국지적인 수상전에서 한 수 늦습니다.",
    ky: "Бул жүрүш жергиликтүү дем жарышында бир темп жоготот.",
  },
  endgame: {
    en: "That move gives up local endgame value or initiative.",
    de: "Dieser Zug verschenkt lokalen Endspielwert oder die Initiative.",
    fr: "Ce coup abandonne de la valeur locale ou l'initiative en fin de partie.",
    es: "Esa jugada cede valor local o la iniciativa en el final.",
    zh: "这手棋损失了局部官子价值或先手。",
    ja: "この手では局所のヨセの価値または先手を失います。",
    ko: "이 수는 국지적인 끝내기 가치나 선수를 잃습니다.",
    ky: "Бул жүрүш жергиликтүү эндшпиль баасын же демилгени жоготот.",
  },
};

export type StaticDailyPuzzleRecord = {
  dailyDate: string;
  cycleOrder: number;
  category: PuzzleCategory;
  rankKyu: number;
  board: Board;
  solutionMove: string;
  solutionX: number;
  solutionY: number;
  difficulty: PuzzleDifficulty;
  explanation: LocalizedText;
  variation: PuzzleVariation;
  sourceId: string;
};

function difficulty(rankKyu: number): PuzzleDifficulty {
  if (rankKyu >= 24) return "beginner";
  if (rankKyu >= 18) return "intermediate";
  return "advanced";
}

export function staticDailyPuzzleForDate(dailyDate: string): StaticDailyPuzzleRecord {
  const puzzle = dailyPuzzleForDate(dailyDate);
  const solution = puzzle.candidateMoves[0];
  if (!solution || puzzle.candidateMoves.length !== 1) {
    throw new Error("Static daily puzzles require exactly one curated solution.");
  }
  const solutionMove = toGtpCoordinate(13, { ...solution, isPass: false });
  const solutionPly = {
    color: "black" as const,
    move: solutionMove,
    x: solution.x,
    y: solution.y,
  };
  return {
    dailyDate,
    cycleOrder: puzzle.cycleOrder,
    category: puzzle.category,
    rankKyu: puzzle.rankKyu,
    board: puzzle.board,
    solutionMove,
    solutionX: solution.x,
    solutionY: solution.y,
    difficulty: difficulty(puzzle.rankKyu),
    explanation: SOLUTION_EXPLANATIONS[puzzle.category],
    variation: {
      version: 1,
      mainLine: [solutionPly],
      refutations: [],
      fallbackExplanation: RETRY_EXPLANATIONS[puzzle.category],
    },
    sourceId: puzzle.sourceId,
  };
}
