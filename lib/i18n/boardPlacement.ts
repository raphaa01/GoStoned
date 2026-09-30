import type { Locale } from "./config";

type BoardPlacementCopy = Readonly<{
  title: string;
  body: string;
  zoom: string;
  zoomBody: string;
  direct: string;
  directBody: string;
  settingsHint: string;
  settingsTitle: string;
  settingsBody: string;
  save: string;
  saving: string;
  saved: string;
  failed: string;
}>;

const COPY: Record<Locale, BoardPlacementCopy> = {
  de: {
    title: "Wie möchtest du Steine setzen?",
    body: "Wähle die Bedienung, die sich auf deinem Gerät am besten anfühlt.",
    zoom: "Mit Präzisionslupe",
    zoomBody: "Gedrückt halten, den Schnittpunkt in der Lupe wählen und loslassen.",
    direct: "Direkt setzen",
    directBody: "Ein kurzes Tippen setzt den Stein sofort auf den gewählten Schnittpunkt.",
    settingsHint: "Du kannst das später jederzeit in den Einstellungen ändern.",
    settingsTitle: "Steine setzen",
    settingsBody: "Diese Auswahl gilt für Partien, Computergegner und Puzzles.",
    save: "Einstellung speichern",
    saving: "Wird gespeichert…",
    saved: "Einstellung gespeichert.",
    failed: "Die Einstellung konnte nicht gespeichert werden.",
  },
  en: {
    title: "How would you like to place stones?",
    body: "Choose the control that feels best on your device.",
    zoom: "Precision magnifier",
    zoomBody: "Press, aim at an intersection in the magnifier, then release.",
    direct: "Place directly",
    directBody: "A short tap places the stone immediately on the selected intersection.",
    settingsHint: "You can change this at any time in Settings.",
    settingsTitle: "Stone placement",
    settingsBody: "This choice applies to games, computer opponents, and puzzles.",
    save: "Save setting",
    saving: "Saving…",
    saved: "Setting saved.",
    failed: "The setting could not be saved.",
  },
  fr: { title: "Comment voulez-vous poser les pierres ?", body: "Choisissez le contrôle le plus confortable sur votre appareil.", zoom: "Loupe de précision", zoomBody: "Maintenez, visez une intersection dans la loupe, puis relâchez.", direct: "Pose directe", directBody: "Un appui bref pose immédiatement la pierre sur l’intersection choisie.", settingsHint: "Vous pourrez modifier ce choix à tout moment dans les réglages.", settingsTitle: "Pose des pierres", settingsBody: "Ce choix s’applique aux parties, aux adversaires ordinateur et aux problèmes.", save: "Enregistrer", saving: "Enregistrement…", saved: "Réglage enregistré.", failed: "Impossible d’enregistrer le réglage." },
  es: { title: "¿Cómo quieres colocar las piedras?", body: "Elige el control que resulte más cómodo en tu dispositivo.", zoom: "Lupa de precisión", zoomBody: "Mantén pulsado, apunta a una intersección en la lupa y suelta.", direct: "Colocación directa", directBody: "Un toque breve coloca la piedra inmediatamente en la intersección elegida.", settingsHint: "Puedes cambiarlo en cualquier momento en Ajustes.", settingsTitle: "Colocación de piedras", settingsBody: "Esta opción se aplica a partidas, rivales de ordenador y problemas.", save: "Guardar ajuste", saving: "Guardando…", saved: "Ajuste guardado.", failed: "No se pudo guardar el ajuste." },
  ja: { title: "石をどのように置きますか？", body: "端末で使いやすい操作方法を選んでください。", zoom: "精密ルーペ", zoomBody: "長押ししてルーペ内の交点を選び、指を離します。", direct: "直接置く", directBody: "短くタップすると選んだ交点にすぐ石を置きます。", settingsHint: "この設定は後からいつでも変更できます。", settingsTitle: "石の置き方", settingsBody: "対局、コンピューター戦、問題に共通して適用されます。", save: "設定を保存", saving: "保存中…", saved: "設定を保存しました。", failed: "設定を保存できませんでした。" },
  ko: { title: "돌을 어떻게 놓을까요?", body: "기기에서 가장 편한 조작 방식을 선택하세요.", zoom: "정밀 돋보기", zoomBody: "길게 누르고 돋보기에서 교차점을 맞춘 뒤 손을 떼세요.", direct: "바로 놓기", directBody: "짧게 누르면 선택한 교차점에 돌이 바로 놓입니다.", settingsHint: "이 설정은 나중에 언제든 변경할 수 있습니다.", settingsTitle: "돌 놓기", settingsBody: "대국, 컴퓨터 상대, 문제에 모두 적용됩니다.", save: "설정 저장", saving: "저장 중…", saved: "설정을 저장했습니다.", failed: "설정을 저장하지 못했습니다." },
  zh: { title: "你想怎样落子？", body: "请选择在你的设备上最顺手的操作方式。", zoom: "精确放大镜", zoomBody: "长按，在放大镜中对准交叉点，然后松开。", direct: "直接落子", directBody: "轻点一下即可立即在所选交叉点落子。", settingsHint: "之后可随时在设置中更改。", settingsTitle: "落子方式", settingsBody: "此选择适用于对局、电脑对手和题目。", save: "保存设置", saving: "正在保存…", saved: "设置已保存。", failed: "无法保存设置。" },
  ky: { title: "Таштарды кантип койгуңуз келет?", body: "Түзмөгүңүздө ыңгайлуу болгон башкарууну тандаңыз.", zoom: "Тактоочу чоңойткуч", zoomBody: "Басып туруңуз, чоңойткучтан кесилишти тандап, коё бериңиз.", direct: "Түз коюу", directBody: "Кыска басуу ташты тандалган кесилишке дароо коёт.", settingsHint: "Муну кийин жөндөөлөрдөн каалаган убакта өзгөртө аласыз.", settingsTitle: "Таш коюу", settingsBody: "Бул тандоо оюндарга, компьютерге каршы оюндарга жана тапшырмаларга колдонулат.", save: "Жөндөөнү сактоо", saving: "Сакталууда…", saved: "Жөндөө сакталды.", failed: "Жөндөөнү сактоо мүмкүн болгон жок." },
};

export function getBoardPlacementCopy(locale: Locale): BoardPlacementCopy {
  return COPY[locale];
}
