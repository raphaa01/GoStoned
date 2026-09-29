import type { Board, Stone } from "@/lib/game/types";
import { createEmptyBoard } from "@/lib/game/goEngine";
import type { LocalizedText } from "@/lib/i18n/config";
import catalogJson from "./gokyoShumyoCatalog.json";
import type {
  GokyoShumyoCategory,
  PuzzleDifficulty,
  PuzzlePly,
  PuzzleVariation,
} from "./types";

type Point = { x: number; y: number };
type CatalogPuzzle = {
  id: string;
  globalOrder: number;
  category: GokyoShumyoCategory;
  sectionOrder: number;
  toPlay: Stone;
  black: Point[];
  white: Point[];
  solution: PuzzlePly;
  mainLine: PuzzlePly[];
  refutations: Array<{ userMove: PuzzlePly; reply: PuzzlePly | null }>;
  rankKyu: number;
  difficulty: PuzzleDifficulty;
  analysis: { engine: string; model: string; visits: number };
};

type Catalog = {
  version: 1;
  source: {
    title: string;
    publicationYear: number;
    nijlBibliographicId: string;
    nijlDoi: string;
  };
  puzzles: CatalogPuzzle[];
};

const catalog = catalogJson as Catalog;

export const GOKYO_SHUMYO_SOURCE = {
  title: "Gokyo Shumyo",
  publicationYear: 1812,
  nijlBibliographicId: "100344678",
  nijlDoi: "10.20730/100344678",
  rights: "Public-domain board facts; no archive images or modern solution text reproduced.",
} as const;

export const GOKYO_SHUMYO_CATEGORY_COUNTS: Record<GokyoShumyoCategory, number> = {
  gokyo_life: 103,
  gokyo_death: 71,
  gokyo_ko: 26,
};

const SOLUTION_COPY: Record<GokyoShumyoCategory, LocalizedText> = {
  gokyo_life: {
    en: "KataGo identifies this as the vital first move for making life. Follow the shown local sequence to secure the eye shape.",
    de: "KataGo erkennt dies als den entscheidenden ersten Zug zum Leben. Folge der gezeigten lokalen Sequenz, um die Augenform zu sichern.",
    fr: "KataGo identifie ce coup comme le premier point vital pour vivre. Suivez la séquence locale affichée afin d'assurer les yeux.",
    es: "KataGo identifica esta como la primera jugada vital para vivir. Sigue la secuencia local mostrada para asegurar los ojos.",
    zh: "KataGo 将此处判断为做活的第一要点。沿着显示的局部次序即可确保眼形。",
    ja: "KataGoはここを生きるための第一の急所と判断しています。表示された局所手順で眼形を確保できます。",
    ko: "KataGo는 이곳을 사는 첫 급소로 판단합니다. 표시된 국지 수순을 따라 눈 모양을 확보하세요.",
    ky: "KataGo бул жерди топту жашаткан биринчи маанилүү жүрүш деп баалайт. Көрсөтүлгөн жергиликтүү тартип көз формасын бекемдейт.",
  },
  gokyo_death: {
    en: "KataGo identifies this as the vital first move for killing. The shown continuation removes the defender's eye space.",
    de: "KataGo erkennt dies als den entscheidenden ersten Zug zum Töten. Die gezeigte Fortsetzung nimmt dem Verteidiger den Augenraum.",
    fr: "KataGo identifie ce coup comme le premier point vital pour tuer. La suite affichée enlève l'espace d'yeux du défenseur.",
    es: "KataGo identifica esta como la primera jugada vital para matar. La continuación mostrada elimina el espacio de ojos del defensor.",
    zh: "KataGo 将此处判断为杀棋的第一要点。显示的后续会破坏防守方的眼位。",
    ja: "KataGoはここを仕留めるための第一の急所と判断しています。表示された続きで守る側の眼形を奪います。",
    ko: "KataGo는 이곳을 잡는 첫 급소로 판단합니다. 표시된 후속 수순이 수비 측의 눈 공간을 없앱니다.",
    ky: "KataGo бул жерди топту өлтүргөн биринчи маанилүү жүрүш деп баалайт. Көрсөтүлгөн уланды коргонуучунун көз мейкиндигин жок кылат.",
  },
  gokyo_ko: {
    en: "KataGo identifies this as the vital first move for reaching the best local ko. The shown continuation preserves the strongest ko shape.",
    de: "KataGo erkennt dies als den entscheidenden ersten Zug zum besten lokalen Ko. Die gezeigte Fortsetzung bewahrt die stärkste Ko-Form.",
    fr: "KataGo identifie ce coup comme le premier point vital pour obtenir le meilleur ko local. La suite affichée conserve la forme de ko la plus forte.",
    es: "KataGo identifica esta como la primera jugada vital para llegar al mejor ko local. La continuación mostrada conserva la forma de ko más fuerte.",
    zh: "KataGo 将此处判断为形成最佳局部劫争的第一要点。显示的后续保留了最强劫形。",
    ja: "KataGoはここを最善の局所コウへ進む第一の急所と判断しています。表示された続きで最も強いコウ形を保ちます。",
    ko: "KataGo는 이곳을 최선의 국지 패로 가는 첫 급소로 판단합니다. 표시된 후속 수순이 가장 강한 패 모양을 유지합니다.",
    ky: "KataGo бул жерди эң жакшы жергиликтүү коого алып барган биринчи маанилүү жүрүш деп баалайт. Көрсөтүлгөн уланды күчтүү коо формасын сактайт.",
  },
};

const RETRY_COPY: LocalizedText = {
  en: "This move leaves a stronger local reply. Compare it with KataGo's forcing sequence and try the vital point again.",
  de: "Dieser Zug lässt eine stärkere lokale Antwort zu. Vergleiche ihn mit KataGos zwingender Folge und versuche den Schlüsselpunkt erneut.",
  fr: "Ce coup laisse une réponse locale plus forte. Comparez-le à la séquence forcée de KataGo et réessayez le point vital.",
  es: "Esta jugada permite una respuesta local más fuerte. Compárala con la secuencia forzada de KataGo e intenta de nuevo el punto vital.",
  zh: "这手棋给对手留下了更强的局部应手。请与 KataGo 的强制次序比较后再找要点。",
  ja: "この手では相手により強い局所応手を許します。KataGoの強制手順と比べ、急所をもう一度探してください。",
  ko: "이 수는 상대에게 더 강한 국지 응수를 허용합니다. KataGo의 강제 수순과 비교해 급소를 다시 찾아보세요.",
  ky: "Бул жүрүш атаандашка күчтүүрөөк жергиликтүү жооп берет. Аны KataGoнун мажбур тартиби менен салыштырып, маанилүү чекитти кайра табыңыз.",
};

export type StaticGokyoShumyoPuzzle = {
  sourceId: string;
  category: GokyoShumyoCategory;
  collectionOrder: number;
  board: Board;
  toPlay: Stone;
  rankKyu: number;
  difficulty: PuzzleDifficulty;
  solution: PuzzlePly;
  explanation: LocalizedText;
  variation: PuzzleVariation;
  engineVersion: string;
  modelName: string;
  visits: number;
};

function boardFor(puzzle: CatalogPuzzle): Board {
  const board = createEmptyBoard(19);
  for (const point of puzzle.black) board[point.y][point.x] = "black";
  for (const point of puzzle.white) {
    if (board[point.y][point.x]) throw new Error(`Overlapping stones in ${puzzle.id}.`);
    board[point.y][point.x] = "white";
  }
  return board;
}

export function gokyoShumyoPuzzles(): StaticGokyoShumyoPuzzle[] {
  if (catalog.version !== 1 || catalog.puzzles.length !== 200) {
    throw new Error("The Gokyo Shumyo catalog is incomplete.");
  }
  return catalog.puzzles.map((puzzle) => ({
    sourceId: puzzle.id,
    category: puzzle.category,
    collectionOrder: puzzle.sectionOrder,
    board: boardFor(puzzle),
    toPlay: puzzle.toPlay,
    rankKyu: puzzle.rankKyu,
    difficulty: puzzle.difficulty,
    solution: puzzle.solution,
    explanation: SOLUTION_COPY[puzzle.category],
    variation: {
      version: 1,
      mainLine: puzzle.mainLine,
      refutations: puzzle.refutations.map((entry) => ({
        ...entry,
        explanation: RETRY_COPY,
      })),
      fallbackExplanation: RETRY_COPY,
    },
    engineVersion: puzzle.analysis.engine,
    modelName: puzzle.analysis.model,
    visits: puzzle.analysis.visits,
  }));
}
