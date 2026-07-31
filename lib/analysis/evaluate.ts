import { coordinateRegion } from "./coordinates";
import type { LocalizedText } from "@/lib/i18n/config";
import {
  ANALYSIS_ENGINE_CONTRACT_VERSION,
  type AnalysisInput,
  type GameAnalysisResult,
  type KataGoTurnResult,
  type MoveAnalysis,
  type MoveClassification,
} from "./types";

export function classifyMove(winrateLoss: number, bestMove: boolean, uniqueness: number): MoveClassification {
  if (bestMove && winrateLoss <= 0.01 && uniqueness >= 0.08) return "brilliant";
  if (bestMove && winrateLoss <= 0.012) return "best";
  if (winrateLoss <= 0.015) return "great";
  if (winrateLoss <= 0.03) return "excellent";
  if (winrateLoss <= 0.06) return "good";
  if (winrateLoss <= 0.12) return "inaccuracy";
  if (winrateLoss <= 0.22) return "mistake";
  return "blunder";
}

function moverPerspective(value: number, resultPlayer: "B" | "W", mover: "black" | "white") {
  return resultPlayer === (mover === "black" ? "B" : "W") ? value : 1 - value;
}

function moverScore(value: number, resultPlayer: "B" | "W", mover: "black" | "white") {
  return resultPlayer === (mover === "black" ? "B" : "W") ? value : -value;
}

function explanations(
  input: AnalysisInput,
  playedMove: string,
  bestMove: string,
  winrateLoss: number,
  scoreLoss: number,
  pv: string[],
) {
  const region = coordinateRegion(bestMove, input.boardSize);
  const continuation = pv.slice(0, 4).join(" – ");
  const regionCopy = {
    en: region === "corner" ? "secures the corner efficiently" : region === "side" ? "builds from the side while staying connected" : region === "center" ? "keeps influence and initiative in the center" : "avoids an unnecessary local commitment",
    de: region === "corner" ? "sichert die Ecke effizient" : region === "side" ? "baut vom Rand aus auf und bleibt verbunden" : region === "center" ? "behält Einfluss und Initiative im Zentrum" : "vermeidet eine unnötige lokale Festlegung",
    fr: region === "corner" ? "sécurise efficacement le coin" : region === "side" ? "se développe depuis le bord tout en restant connecté" : region === "center" ? "conserve l'influence et l'initiative au centre" : "évite un engagement local inutile",
    es: region === "corner" ? "asegura la esquina con eficiencia" : region === "side" ? "se desarrolla desde el lateral sin perder la conexión" : region === "center" ? "mantiene la influencia y la iniciativa en el centro" : "evita un compromiso local innecesario",
    zh: region === "corner" ? "高效守住角部" : region === "side" ? "从边上发展并保持连接" : region === "center" ? "保持中央的影响力和先手" : "避免不必要的局部定型",
    ja: region === "corner" ? "隅を効率よく確保します" : region === "side" ? "連絡を保ちながら辺から展開します" : region === "center" ? "中央での影響力と先手を保ちます" : "不要な局地戦を避けます",
    ko: region === "corner" ? "귀를 효율적으로 지킵니다" : region === "side" ? "연결을 유지하며 변에서 전개합니다" : region === "center" ? "중앙의 영향력과 선수를 유지합니다" : "불필요한 국지전을 피합니다",
  } satisfies LocalizedText;
  const sequence = {
    en: pv.length > 1 ? ` The expected continuation starts ${continuation}.` : "",
    de: pv.length > 1 ? ` Die erwartete Fortsetzung beginnt mit ${continuation}.` : "",
    fr: pv.length > 1 ? ` La suite attendue commence par ${continuation}.` : "",
    es: pv.length > 1 ? ` La continuación prevista comienza con ${continuation}.` : "",
    zh: pv.length > 1 ? ` 预期后续从 ${continuation} 开始。` : "",
    ja: pv.length > 1 ? ` 想定される進行は ${continuation} から始まります。` : "",
    ko: pv.length > 1 ? ` 예상 진행은 ${continuation}로 시작합니다.` : "",
  } satisfies LocalizedText;
  if (playedMove === bestMove) {
    return {
      en: `${bestMove} is KataGo's first choice. It ${regionCopy.en} and preserves the position's winning chances.${sequence.en}`,
      de: `${bestMove} ist KataGos erste Wahl. Der Zug ${regionCopy.de} und erhält die Gewinnchancen der Stellung.${sequence.de}`,
      fr: `${bestMove} est le premier choix de KataGo. Ce coup ${regionCopy.fr} et préserve les chances de victoire de la position.${sequence.fr}`,
      es: `${bestMove} es la primera opción de KataGo. La jugada ${regionCopy.es} y conserva las posibilidades de victoria de la posición.${sequence.es}`,
      zh: `${bestMove} 是 KataGo 的首选。这手棋${regionCopy.zh}，并保持当前局面的胜率。${sequence.zh}`,
      ja: `${bestMove} はKataGoの第一候補です。この手は${regionCopy.ja}、局面の勝率を維持します。${sequence.ja}`,
      ko: `${bestMove}는 KataGo의 최우선 수입니다. 이 수는 ${regionCopy.ko} 포지션의 승률을 유지합니다.${sequence.ko}`,
    } satisfies LocalizedText;
  }
  const loss = (winrateLoss * 100).toFixed(1);
  const points = Math.abs(scoreLoss).toFixed(1);
  return {
    en: `${bestMove} is stronger than ${playedMove}: it ${regionCopy.en}. KataGo estimates about ${loss} percentage points more winning chance and ${points} points more score for the player to move.${sequence.en}`,
    de: `${bestMove} ist stärker als ${playedMove}: Der Zug ${regionCopy.de}. KataGo schätzt etwa ${loss} Prozentpunkte mehr Gewinnchance und ${points} Punkte mehr Ergebnis für den Spieler am Zug.${sequence.de}`,
    fr: `${bestMove} est plus fort que ${playedMove} : ce coup ${regionCopy.fr}. KataGo estime environ ${loss} points de pourcentage de chances de victoire et ${points} points de score supplémentaires pour le joueur au trait.${sequence.fr}`,
    es: `${bestMove} es más fuerte que ${playedMove}: la jugada ${regionCopy.es}. KataGo estima unos ${loss} puntos porcentuales más de probabilidad de victoria y ${points} puntos más para el jugador que mueve.${sequence.es}`,
    zh: `${bestMove} 比 ${playedMove} 更强：这手棋${regionCopy.zh}。KataGo 估计当前行棋方可多获得约 ${loss} 个百分点的胜率和 ${points} 目。${sequence.zh}`,
    ja: `${bestMove} は ${playedMove} より優れています。この手は${regionCopy.ja}。KataGoは手番側の勝率が約 ${loss} ポイント、スコアが ${points} 目高くなると推定しています。${sequence.ja}`,
    ko: `${bestMove}는 ${playedMove}보다 강합니다. 이 수는 ${regionCopy.ko}. KataGo는 둘 차례인 쪽의 승률이 약 ${loss}%포인트, 점수가 ${points}집 높아진다고 평가합니다.${sequence.ko}`,
  } satisfies LocalizedText;
}

function emptySummary(): Record<MoveClassification, number> {
  return { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
}

export function buildGameAnalysis(
  input: AnalysisInput,
  turns: KataGoTurnResult[],
  engine: { version: string; model: string; visitsPerTurn: number },
  analyzedAt = new Date().toISOString(),
): GameAnalysisResult {
  const byTurn = new Map(turns.map((turn) => [turn.turnNumber, turn]));
  const analyses: MoveAnalysis[] = input.moves.map((played, index) => {
    const before = byTurn.get(index);
    const after = byTurn.get(index + 1);
    if (!before || !after || before.moveInfos.length === 0) {
      throw new Error(`KataGo did not return a complete result for move ${index + 1}.`);
    }
    const ranked = [...before.moveInfos].sort((a, b) => a.order - b.order);
    const best = ranked[0];
    const second = ranked[1];
    const actualWinrate = moverPerspective(after.rootInfo.winrate, after.rootInfo.currentPlayer, played.color);
    const actualScore = moverScore(after.rootInfo.scoreLead, after.rootInfo.currentPlayer, played.color);
    const loss = Math.max(0, best.winrate - actualWinrate);
    const scoreLoss = Math.max(0, best.scoreLead - actualScore);
    const uniqueness = second ? Math.max(0, best.winrate - second.winrate) : 0;
    const classification = classifyMove(loss, best.move.toLowerCase() === played.move.toLowerCase(), uniqueness);
    return {
      moveNumber: index + 1,
      color: played.color,
      playedMove: played.move,
      classification,
      winrateBefore: before.rootInfo.winrate,
      winrateAfter: actualWinrate,
      winrateLoss: loss,
      scoreLeadBefore: before.rootInfo.scoreLead,
      scoreLeadAfter: actualScore,
      scoreLoss,
      bestMove: best.move,
      alternatives: ranked.slice(0, 3).map((candidate) => ({
        move: candidate.move,
        winrate: candidate.winrate,
        scoreLead: candidate.scoreLead,
        visits: candidate.visits,
        pv: candidate.pv,
      })),
      explanation: explanations(input, played.move, best.move, loss, scoreLoss, best.pv),
    };
  });
  const summary = emptySummary();
  for (const move of analyses) summary[move.classification] += 1;
  return {
    contractVersion: ANALYSIS_ENGINE_CONTRACT_VERSION,
    engine: { name: "KataGo", ...engine },
    gameId: input.gameId,
    gameVersion: input.gameVersion,
    boardSize: input.boardSize,
    analyzedAt,
    moves: analyses,
    summary,
  };
}
