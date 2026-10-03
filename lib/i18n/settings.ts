import type { Locale } from "./config";

type SettingsCopy = {
  title: string;
  back: string;
  appearance: string;
  appearanceBody: string;
  system: string;
  light: string;
  dark: string;
  loading: string;
  loadFailed: string;
  retry: string;
};

const COPY: Record<Locale, SettingsCopy> = {
  en: { title: "Settings", back: "Back to profile", appearance: "Appearance", appearanceBody: "Use the system setting or choose light or dark mode. Your choice is saved on this device.", system: "System", light: "Light mode", dark: "Dark mode", loading: "Loading setting…", loadFailed: "The stone placement setting could not be loaded.", retry: "Try again" },
  de: { title: "Einstellungen", back: "Zurück zum Profil", appearance: "Erscheinungsbild", appearanceBody: "Nutze die Systemeinstellung oder wähle den hellen oder dunklen Modus. Deine Auswahl wird auf diesem Gerät gespeichert.", system: "System", light: "Lightmode", dark: "Darkmode", loading: "Einstellung wird geladen…", loadFailed: "Die Einstellung zum Steinesetzen konnte nicht geladen werden.", retry: "Erneut versuchen" },
  fr: { title: "Réglages", back: "Retour au profil", appearance: "Apparence", appearanceBody: "Suivez le système ou choisissez le mode clair ou sombre. Votre choix est enregistré sur cet appareil.", system: "Système", light: "Mode clair", dark: "Mode sombre", loading: "Chargement du réglage…", loadFailed: "Impossible de charger le réglage de pose des pierres.", retry: "Réessayer" },
  es: { title: "Ajustes", back: "Volver al perfil", appearance: "Apariencia", appearanceBody: "Usa el ajuste del sistema o elige el modo claro u oscuro. Tu elección se guarda en este dispositivo.", system: "Sistema", light: "Modo claro", dark: "Modo oscuro", loading: "Cargando ajuste…", loadFailed: "No se pudo cargar el ajuste de colocación de piedras.", retry: "Reintentar" },
  zh: { title: "设置", back: "返回个人资料", appearance: "外观", appearanceBody: "跟随系统或选择浅色或深色模式。你的选择将保存在此设备上。", system: "系统", light: "浅色模式", dark: "深色模式", loading: "正在加载设置…", loadFailed: "无法加载落子方式设置。", retry: "重试" },
  ja: { title: "設定", back: "プロフィールに戻る", appearance: "外観", appearanceBody: "システム設定に従うか、ライトまたはダークモードを選びます。選択はこの端末に保存されます。", system: "システム", light: "ライトモード", dark: "ダークモード", loading: "設定を読み込み中…", loadFailed: "石の置き方の設定を読み込めませんでした。", retry: "再試行" },
  ko: { title: "설정", back: "프로필로 돌아가기", appearance: "화면 모드", appearanceBody: "시스템 설정을 따르거나 밝은 모드 또는 어두운 모드를 선택하세요. 선택은 이 기기에 저장됩니다.", system: "시스템", light: "밝은 모드", dark: "어두운 모드", loading: "설정 불러오는 중…", loadFailed: "돌 놓기 설정을 불러오지 못했습니다.", retry: "다시 시도" },
  ky: { title: "Жөндөөлөр", back: "Профилге кайтуу", appearance: "Көрүнүш", appearanceBody: "Системанын жөндөөсүн колдонуңуз же жарык же караңгы режимди тандаңыз. Тандооңуз бул түзмөктө сакталат.", system: "Система", light: "Жарык режим", dark: "Караңгы режим", loading: "Жөндөө жүктөлүүдө…", loadFailed: "Таш коюу жөндөөсүн жүктөө мүмкүн болгон жок.", retry: "Кайра аракет кылуу" },
};

export function getSettingsCopy(locale: Locale): SettingsCopy {
  return COPY[locale];
}
