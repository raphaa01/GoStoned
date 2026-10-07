import type { Locale } from "./config";

const copy: Record<Locale, { uncertain: string; alive: string; dead: string }> = {
  en: { uncertain: "Review unclear groups", alive: "Alive", dead: "Dead" },
  de: { uncertain: "Unklare Gruppen prüfen", alive: "Lebend", dead: "Tot" },
  fr: { uncertain: "Vérifier les groupes incertains", alive: "Vivant", dead: "Mort" },
  es: { uncertain: "Revisar grupos inciertos", alive: "Vivo", dead: "Muerto" },
  ja: { uncertain: "不明なグループを確認", alive: "生き", dead: "死に" },
  ko: { uncertain: "불확실한 돌무리 확인", alive: "삶", dead: "죽음" },
  zh: { uncertain: "确认不明确的棋块", alive: "活棋", dead: "死棋" },
  ky: { uncertain: "Белгисиз топторду текшерүү", alive: "Тирүү", dead: "Өлүк" },
};

export function getSettlementCopy(locale: Locale) { return copy[locale]; }
