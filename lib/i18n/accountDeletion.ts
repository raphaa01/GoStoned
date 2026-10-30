import type { Locale } from "./config";

const EN = {
  title: "Delete your GoStone account",
  action: "Delete account",
  dataTitle: "What happens to your data",
  data: "Deletion permanently removes your profile, sign-in details, all sessions, messages, friends, saved progress and preferences. Active games end as resignations. Shared games and immutable rating evidence remain without your profile or sign-in details to preserve opponents’ history. Rolling backups expire under the provider’s backup cycle.",
  privacy: "Privacy policy",
  inAppTitle: "Delete account",
  inAppIntro: "Permanently delete this account or guest profile and its personal data now. You only need to confirm below. No new account, password, email or support contact is required.",
  consent: "I understand that deletion is permanent and cannot be undone.",
  sending: "Deleting account…",
  loading: "Loading account deletion…",
  failed: "Account deletion could not be completed. Please try again.",
  retry: "Try again",
  signIn: "Sign in to your existing account to delete it. For a guest profile, use the device where you played.",
  signInAction: "Sign in",
  cancel: "Cancel",
  completed: "Your GoStone account and associated personal data have been deleted. You have been signed out.",
  appleNote: "If you used Apple sign-in before GoStone could store a revocation token, the old Apple authorization may still appear in your Apple Account settings. You may remove it there; your GoStone account is already deleted.",
  reference: "Deletion reference",
};

const DE: typeof EN = {
  title: "Dein GoStone-Konto löschen",
  action: "Konto löschen",
  dataTitle: "Was mit deinen Daten geschieht",
  data: "Die Löschung entfernt dein Profil, Anmeldedaten, alle Sitzungen, Nachrichten, Freunde, gespeicherte Fortschritte und Einstellungen endgültig. Laufende Partien werden als Aufgabe beendet. Gemeinsame Partien und unveränderliche Wertungsnachweise bleiben ohne dein Profil und deine Anmeldedaten erhalten, damit der Verlauf deiner Gegner bestehen bleibt. Rollierende Sicherungskopien verfallen nach dem Sicherungszyklus des Anbieters.",
  privacy: "Datenschutzerklärung",
  inAppTitle: "Konto löschen",
  inAppIntro: "Lösche dieses Konto oder Gastprofil und die zugehörigen persönlichen Daten jetzt endgültig. Du musst die Löschung unten nur bestätigen. Ein neues Konto, Passwort, eine E-Mail oder ein Supportkontakt sind nicht erforderlich.",
  consent: "Ich verstehe, dass die Löschung endgültig ist und nicht rückgängig gemacht werden kann.",
  sending: "Konto wird gelöscht…",
  loading: "Kontolöschung wird geladen…",
  failed: "Die Kontolöschung konnte nicht abgeschlossen werden. Bitte versuche es erneut.",
  retry: "Erneut versuchen",
  signIn: "Melde dich bei deinem bestehenden Konto an, um es zu löschen. Für ein Gastprofil nutze das Gerät, auf dem du gespielt hast.",
  signInAction: "Anmelden",
  cancel: "Abbrechen",
  completed: "Dein GoStone-Konto und die zugehörigen persönlichen Daten wurden gelöscht. Du wurdest abgemeldet.",
  appleNote: "Falls du die Apple-Anmeldung genutzt hast, bevor GoStone ein Widerrufstoken speichern konnte, kann die alte Apple-Freigabe noch in deinen Apple-Account-Einstellungen erscheinen. Du kannst sie dort entfernen; dein GoStone-Konto ist bereits gelöscht.",
  reference: "Löschbestätigung",
};

// Other app languages show English instructions with an explicit language tag.
export function getAccountDeletionCopy(locale: Locale) {
  return locale === "de" ? DE : EN;
}

export function accountDeletionLanguage(locale: Locale): "de" | "en" {
  return locale === "de" ? "de" : "en";
}
