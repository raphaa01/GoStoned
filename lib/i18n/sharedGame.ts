import type { Locale } from "./config";

const english = {
  brand: "GoStone",
  share: "Share game",
  sharing: "Creating link …",
  copied: "Link copied",
  shareFailed: "Could not create the link.",
  shareText: "Finished Go game",
  eyebrow: "Shared game",
  navigation: "Game moves",
  firstMove: "Go to start",
  previousMove: "Previous move",
  nextMove: "Next move",
  lastMove: "Go to end",
  startPosition: "Start position",
  finalPosition: "Final position",
  openLink: "Open game",
  copyLink: "Copy link",
  unavailable: "This shared game is unavailable.",
  loading: "Loading game …",
  moves: "moves",
};

const copies: Record<Locale, typeof english> = {
  en: english,
  de: { ...english, share: "Partie teilen", sharing: "Link wird erstellt …", copied: "Link kopiert", shareFailed: "Link konnte nicht erstellt werden.", shareText: "Fertige Go-Partie", eyebrow: "Geteilte Partie", navigation: "Zugverlauf", firstMove: "Zum Anfang", previousMove: "Vorheriger Zug", nextMove: "Nächster Zug", lastMove: "Zum Endstand", startPosition: "Anfang", finalPosition: "Endstand", openLink: "Partie öffnen", copyLink: "Link kopieren", unavailable: "Diese geteilte Partie ist nicht verfügbar.", loading: "Partie wird geladen …", moves: "Züge" },
  fr: { ...english, share: "Partager la partie", sharing: "Création du lien…", copied: "Lien copié", shareFailed: "Impossible de créer le lien.", shareText: "Partie de go terminée", eyebrow: "Partie partagée", navigation: "Coups de la partie", firstMove: "Aller au début", previousMove: "Coup précédent", nextMove: "Coup suivant", lastMove: "Aller à la fin", startPosition: "Début", finalPosition: "Position finale", openLink: "Ouvrir la partie", copyLink: "Copier le lien", unavailable: "Cette partie partagée est indisponible.", loading: "Chargement de la partie…", moves: "coups" },
  es: { ...english, share: "Compartir partida", sharing: "Creando enlace…", copied: "Enlace copiado", shareFailed: "No se pudo crear el enlace.", shareText: "Partida de Go finalizada", eyebrow: "Partida compartida", navigation: "Jugadas de la partida", firstMove: "Ir al inicio", previousMove: "Jugada anterior", nextMove: "Jugada siguiente", lastMove: "Ir al final", startPosition: "Inicio", finalPosition: "Posición final", openLink: "Abrir partida", copyLink: "Copiar enlace", unavailable: "Esta partida compartida no está disponible.", loading: "Cargando partida…", moves: "jugadas" },
  zh: { ...english, share: "分享对局", sharing: "正在创建链接…", copied: "链接已复制", shareFailed: "无法创建链接。", shareText: "已结束的围棋对局", eyebrow: "已分享对局", navigation: "对局棋谱", firstMove: "回到开局", previousMove: "上一手", nextMove: "下一手", lastMove: "到终局", startPosition: "开局", finalPosition: "终局", openLink: "打开对局", copyLink: "复制链接", unavailable: "此分享对局不可用。", loading: "正在加载对局…", moves: "手" },
  ja: { ...english, share: "対局を共有", sharing: "リンクを作成中…", copied: "リンクをコピーしました", shareFailed: "リンクを作成できませんでした。", shareText: "終了した囲碁対局", eyebrow: "共有対局", navigation: "棋譜", firstMove: "最初へ", previousMove: "前の手", nextMove: "次の手", lastMove: "最後へ", startPosition: "開始局面", finalPosition: "終局", openLink: "対局を開く", copyLink: "リンクをコピー", unavailable: "この共有対局は利用できません。", loading: "対局を読み込み中…", moves: "手" },
  ko: { ...english, share: "대국 공유", sharing: "링크 만드는 중…", copied: "링크 복사됨", shareFailed: "링크를 만들 수 없습니다.", shareText: "종료된 바둑 대국", eyebrow: "공유 대국", navigation: "기보", firstMove: "처음으로", previousMove: "이전 수", nextMove: "다음 수", lastMove: "마지막으로", startPosition: "시작 국면", finalPosition: "최종 국면", openLink: "대국 열기", copyLink: "링크 복사", unavailable: "이 공유 대국을 볼 수 없습니다.", loading: "대국 불러오는 중…", moves: "수" },
  ky: english,
};

export function getSharedGameCopy(locale: Locale) {
  return copies[locale];
}
