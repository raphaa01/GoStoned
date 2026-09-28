import type { Locale } from "./config";

const english = {
  brand: "GoStone",
  share: "Share game",
  sharing: "Creating link …",
  copied: "Link copied",
  shareFailed: "Could not create the link.",
  shareText: "Finished Go game",
  eyebrow: "Shared game",
  staticNote: "Static final position · no moves or analysis",
  unavailable: "This shared game is unavailable.",
  loading: "Loading game …",
  moves: "moves",
};

const copies: Record<Locale, typeof english> = {
  en: english,
  de: { ...english, share: "Partie teilen", sharing: "Link wird erstellt …", copied: "Link kopiert", shareFailed: "Link konnte nicht erstellt werden.", shareText: "Fertige Go-Partie", eyebrow: "Geteilte Partie", staticNote: "Statische Endposition · keine Züge oder Analyse", unavailable: "Diese geteilte Partie ist nicht verfügbar.", loading: "Partie wird geladen …", moves: "Züge" },
  fr: { ...english, share: "Partager la partie", sharing: "Création du lien…", copied: "Lien copié", shareFailed: "Impossible de créer le lien.", shareText: "Partie de go terminée", eyebrow: "Partie partagée", staticNote: "Position finale statique · aucun coup ni analyse", unavailable: "Cette partie partagée est indisponible.", loading: "Chargement de la partie…", moves: "coups" },
  es: { ...english, share: "Compartir partida", sharing: "Creando enlace…", copied: "Enlace copiado", shareFailed: "No se pudo crear el enlace.", shareText: "Partida de Go finalizada", eyebrow: "Partida compartida", staticNote: "Posición final estática · sin jugadas ni análisis", unavailable: "Esta partida compartida no está disponible.", loading: "Cargando partida…", moves: "jugadas" },
  zh: { ...english, share: "分享对局", sharing: "正在创建链接…", copied: "链接已复制", shareFailed: "无法创建链接。", shareText: "已结束的围棋对局", eyebrow: "已分享对局", staticNote: "静态终局 · 无法落子或分析", unavailable: "此分享对局不可用。", loading: "正在加载对局…", moves: "手" },
  ja: { ...english, share: "対局を共有", sharing: "リンクを作成中…", copied: "リンクをコピーしました", shareFailed: "リンクを作成できませんでした。", shareText: "終了した囲碁対局", eyebrow: "共有対局", staticNote: "静的な終局図 · 着手・解析はできません", unavailable: "この共有対局は利用できません。", loading: "対局を読み込み中…", moves: "手" },
  ko: { ...english, share: "대국 공유", sharing: "링크 만드는 중…", copied: "링크 복사됨", shareFailed: "링크를 만들 수 없습니다.", shareText: "종료된 바둑 대국", eyebrow: "공유 대국", staticNote: "정적인 최종 국면 · 착수 및 분석 불가", unavailable: "이 공유 대국을 볼 수 없습니다.", loading: "대국 불러오는 중…", moves: "수" },
  ky: english,
};

export function getSharedGameCopy(locale: Locale) {
  return copies[locale];
}
