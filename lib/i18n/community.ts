import type { Locale } from "./config";
const EN = {
  title: "Community rules", agree: "I accept the", rules: "community rules", privacy: "Privacy", contact: "Contact",
  report: "Report", reportTitle: "Report player", category: "Reason", send: "Send report", sent: "Report received", cancel: "Cancel", failed: "Please try again.",
  suspended: "Chat access is temporarily suspended.", moderation: "Moderation", empty: "No open reports", refresh: "Refresh", confirm: "Confirm decision?",
  closed: "Closed reports", open: "Open reports", restore: "Lift action", dismiss: "Close without action", remove_chat: "Remove chat", suspend_7d: "Suspend for 7 days", evidence: "Recent messages", pending: "Sending…",
  categories: ["Abuse or hate", "Threats or sexual / child safety", "Unfair play", "Stalling or abandonment", "Spam, scams or impersonation", "Other"],
  paragraphs: [
    "Treat others respectfully. Harassment, hate, threats, sexual exploitation, child abuse and illegal content are prohibited.",
    "Play fairly. Do not use outside help in human games, manipulate results, impersonate others or deliberately disrupt games.",
    "Do not post spam, scams or someone else’s private information. These rules also apply to usernames and shared content.",
    "Use Report or Block in the game chat. Moderators can remove chat content and suspend community access. Reports are private; reporting alone does not penalize a player.",
    "For urgent safety concerns, appeals or privacy requests, use the contact below. For immediate danger, contact local emergency services.",
  ],
  retention: "Moderation stores the report category, participants, conversation and an audited decision. Only authorized moderators can inspect the reported conversation. Removed messages become eligible for cleanup after 90 days; closed decisions after 180 days. Cleanup runs during moderation processing. Account deletion removes messages and consent records. Contact us for review or an appeal.",
};
type Copy = typeof EN;
const DE: Copy = {
  title: "Community-Regeln", agree: "Ich akzeptiere die", rules: "Community-Regeln", privacy: "Datenschutz", contact: "Kontakt",
  report: "Melden", reportTitle: "Spieler melden", category: "Grund", send: "Meldung senden", sent: "Meldung eingegangen", cancel: "Abbrechen", failed: "Bitte erneut versuchen.",
  suspended: "Der Chatzugang ist vorübergehend gesperrt.", moderation: "Moderation", empty: "Keine offenen Meldungen", refresh: "Aktualisieren", confirm: "Entscheidung bestätigen?",
  closed: "Abgeschlossene Meldungen", open: "Offene Meldungen", restore: "Maßnahme aufheben", dismiss: "Ohne Maßnahme schließen", remove_chat: "Chat entfernen", suspend_7d: "7 Tage sperren", evidence: "Letzte Nachrichten", pending: "Wird gesendet…",
  categories: ["Beleidigung oder Hass", "Drohung, sexuelle Inhalte oder Kindeswohl", "Unfaires Spiel", "Verzögern oder Verlassen", "Spam, Betrug oder Identitätstäuschung", "Sonstiges"],
  paragraphs: [
    "Behandle andere respektvoll. Belästigung, Hass, Drohungen, sexuelle Ausbeutung, Kindesmissbrauch und rechtswidrige Inhalte sind verboten.",
    "Spiele fair. Nutze gegen Menschen keine fremde Hilfe, manipuliere keine Ergebnisse, täusche keine Identitäten vor und störe Partien nicht absichtlich.",
    "Veröffentliche keinen Spam, Betrug und keine privaten Daten anderer. Die Regeln gelten auch für Benutzernamen und geteilte Inhalte.",
    "Nutze Melden oder Blockieren im Partiechat. Moderatoren können Chats entfernen und den Community-Zugang sperren. Meldungen sind vertraulich; eine Meldung allein bestraft niemanden.",
    "Für dringende Sicherheitsfragen, Einsprüche und Datenschutzanliegen nutze den Kontakt unten. Bei unmittelbarer Gefahr wende dich an den örtlichen Notruf.",
  ],
  retention: "Die Moderation speichert Meldegrund, Beteiligte, Unterhaltung und die protokollierte Entscheidung. Nur berechtigte Moderatoren können die gemeldete Unterhaltung einsehen. Entfernte Nachrichten werden nach 90 Tagen, abgeschlossene Entscheidungen nach 180 Tagen zur Bereinigung bei der Moderationsbearbeitung vorgemerkt. Eine Kontolöschung entfernt Nachrichten und Zustimmungen. Für eine Überprüfung oder einen Einspruch kontaktiere uns.",
};
const LABELS: Partial<Record<Locale, Partial<Copy>>> = {
  fr: { title: "Règles de la communauté", agree: "J’accepte les", rules: "règles de la communauté", privacy: "Confidentialité", contact: "Contact", report: "Signaler", reportTitle: "Signaler un joueur", category: "Motif", send: "Envoyer", sent: "Signalement reçu", cancel: "Annuler", failed: "Veuillez réessayer." },
  es: { title: "Normas de la comunidad", agree: "Acepto las", rules: "normas de la comunidad", privacy: "Privacidad", contact: "Contacto", report: "Denunciar", reportTitle: "Denunciar jugador", category: "Motivo", send: "Enviar", sent: "Denuncia recibida", cancel: "Cancelar", failed: "Vuelve a intentarlo." },
  zh: { title: "社区规则", agree: "我接受", rules: "社区规则", privacy: "隐私", contact: "联系", report: "举报", reportTitle: "举报玩家", category: "原因", send: "提交举报", sent: "举报已收到", cancel: "取消", failed: "请重试。" },
  ja: { title: "コミュニティ規則", agree: "同意します：", rules: "コミュニティ規則", privacy: "プライバシー", contact: "お問い合わせ", report: "通報", reportTitle: "プレイヤーを通報", category: "理由", send: "送信", sent: "通報を受け付けました", cancel: "キャンセル", failed: "もう一度お試しください。" },
  ko: { title: "커뮤니티 규칙", agree: "동의합니다:", rules: "커뮤니티 규칙", privacy: "개인정보", contact: "문의", report: "신고", reportTitle: "플레이어 신고", category: "사유", send: "신고 보내기", sent: "신고가 접수되었습니다", cancel: "취소", failed: "다시 시도해 주세요." },
  ky: { title: "Коомчулук эрежелери", agree: "Мен кабыл алам:", rules: "коомчулук эрежелерин", privacy: "Купуялык", contact: "Байланыш", report: "Даттануу", reportTitle: "Оюнчуга даттануу", category: "Себеп", send: "Жөнөтүү", sent: "Даттануу кабыл алынды", cancel: "Жокко чыгаруу", failed: "Кайра аракет кылыңыз." },
};
export function getCommunityCopy(locale: Locale): Copy { return locale === "de" ? DE : { ...EN, ...LABELS[locale] }; }
