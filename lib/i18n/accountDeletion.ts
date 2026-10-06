import type { Locale } from "./config";

const EN = {
  title: "Delete your GoStone account",
  settingsTitle: "Account deletion",
  intro: "You can request deletion of your GoStone account and associated personal data by email. You do not need to install the app or sign in to make a request.",
  action: "Request account deletion",
  instructionsTitle: "How to request deletion",
  instructions: "Email the contact below with the subject ‘GoStone account deletion’. Include your GoStone username and, if you use Google or Apple sign-in, the email address associated with that account. Never send your password or a sign-in code. We may ask you to verify ownership before processing the request.",
  dataTitle: "What happens to your data",
  data: "The request covers your account and associated personal data, including profile and sign-in information, sessions, messages, and saved progress. Shared game records may be retained in an anonymized form. Data needed for security, fraud prevention, legal obligations or legal claims may be retained where necessary. Backup copies remain until the provider's rolling backup cycle expires. See our privacy policy for the applicable retention criteria.",
  confirmation: "This is a request handled by GoStone support. Sending the request does not immediately delete your account. Support will explain any verification steps and confirm the outcome. Once completed, deletion cannot be undone.",
  unavailable: "The deletion contact is temporarily unavailable. Please use the contact details in our privacy policy.",
  privacy: "Privacy policy",
  inAppTitle: "Request deletion in GoStone",
  inAppIntro: "Request deletion of this account or guest profile and associated personal data. GoStone support will process the request within 7 days. You can check the result here, including after your sign-in access is removed.",
  emailLabel: "Confirmation email (optional)",
  emailHint: "Leave this blank to check the result here. Never enter a password or sign-in code.",
  consent: "I understand that completed deletion is permanent and cannot be undone.",
  sending: "Sending request...",
  loading: "Checking deletion requests...",
  failed: "The request could not be completed. Please try again.",
  retry: "Try again",
  signIn: "Sign in to request account deletion. If you played as a guest, open this page on the device where you played.",
  pending: "Your deletion request has been received.",
  processing: "Your deletion request is being processed.",
  completed: "Your account deletion has been completed.",
  due: "Completion due by",
  reference: "Request reference",
};

const DE: typeof EN = {
  title: "Dein GoStone-Konto löschen",
  settingsTitle: "Kontolöschung",
  intro: "Du kannst die Löschung deines GoStone-Kontos und der zugehörigen personenbezogenen Daten per E-Mail anfordern. Dafür musst du die App weder installieren noch angemeldet sein.",
  action: "Kontolöschung anfordern",
  instructionsTitle: "So forderst du die Löschung an",
  instructions: "Schreibe an die unten angegebene Adresse mit dem Betreff ‚GoStone-Kontolöschung‘. Nenne deinen GoStone-Benutzernamen und bei einer Anmeldung mit Google oder Apple die zugehörige E-Mail-Adresse. Sende niemals dein Passwort oder einen Anmeldecode. Vor der Bearbeitung können wir dich bitten, die Inhaberschaft des Kontos nachzuweisen.",
  dataTitle: "Was mit deinen Daten geschieht",
  data: "Die Anfrage betrifft dein Konto und die zugehörigen personenbezogenen Daten, darunter Profil- und Anmeldeinformationen, Sitzungen, Nachrichten und gespeicherte Fortschritte. Gemeinsame Partiedatensätze können in anonymisierter Form erhalten bleiben. Daten für Sicherheit, Betrugsprävention, gesetzliche Pflichten oder Rechtsansprüche können im erforderlichen Umfang aufbewahrt werden. Sicherungskopien verbleiben bis zum Ablauf des rollierenden Sicherungszyklus des Anbieters. Die geltenden Aufbewahrungskriterien findest du in unserer Datenschutzerklärung.",
  confirmation: "Die Anfrage wird vom GoStone-Support bearbeitet. Durch das Absenden wird dein Konto nicht sofort gelöscht. Der Support erklärt mögliche Nachweisschritte und bestätigt das Ergebnis. Eine abgeschlossene Löschung kann nicht rückgängig gemacht werden.",
  unavailable: "Der Kontakt für Löschanfragen ist vorübergehend nicht verfügbar. Bitte nutze die Kontaktdaten in unserer Datenschutzerklärung.",
  privacy: "Datenschutzerklärung",
  inAppTitle: "Löschung in GoStone anfordern",
  inAppIntro: "Fordere die Löschung dieses Kontos oder Gastprofils und der zugehörigen personenbezogenen Daten an. Der GoStone-Support bearbeitet die Anfrage innerhalb von 7 Tagen. Du kannst das Ergebnis hier prüfen, auch nachdem dein Anmeldezugang entfernt wurde.",
  emailLabel: "E-Mail für die Bestätigung (optional)",
  emailHint: "Lasse dieses Feld leer, um das Ergebnis hier zu prüfen. Gib niemals ein Passwort oder einen Anmeldecode ein.",
  consent: "Ich verstehe, dass eine abgeschlossene Löschung endgültig ist und nicht rückgängig gemacht werden kann.",
  sending: "Anfrage wird gesendet...",
  loading: "Löschanfragen werden geprüft...",
  failed: "Die Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.",
  retry: "Erneut versuchen",
  signIn: "Melde dich an, um die Kontolöschung anzufordern. Wenn du als Gast gespielt hast, öffne diese Seite auf dem Gerät, auf dem du gespielt hast.",
  pending: "Deine Löschanfrage ist eingegangen.",
  processing: "Deine Löschanfrage wird bearbeitet.",
  completed: "Deine Kontolöschung wurde abgeschlossen.",
  due: "Abschluss spätestens am",
  reference: "Anfragenummer",
};

// The store release supports English and German deletion instructions. Other
// app languages show the English instructions with an explicit language tag.
export function getAccountDeletionCopy(locale: Locale) {
  return locale === "de" ? DE : EN;
}

export function accountDeletionLanguage(locale: Locale): "de" | "en" {
  return locale === "de" ? "de" : "en";
}
