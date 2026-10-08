import type { Locale } from "./config";
const de = {
  title: "Spiele gegen Coach", beta: "Beta", size: "Brettgröße", start: "Spiel starten", ready: "Wähle die Brettgröße. Du spielst Schwarz.",
  rating: "Der Gegner orientiert sich an deiner Spielstärke", ratingApproximate: "Die Stärkeanpassung ist noch eine Näherung.",
  preparing: "Coach wird vorbereitet …", unavailable: "Lokales KataGo ist auf diesem Gerät nicht verfügbar.", blocked: "Diese Beta ist für dein Konto noch nicht freigeschaltet.",
  initial: "Setze deinen ersten Stein. Ich schaue mir deine Züge an.", analysing: "Ich schaue mir deinen Zug an …", thinking: "Coach überlegt …", yourTurn: "Du bist am Zug", noComment: "Für diesen Zug habe ich keinen sicheren Kommentar.",
  help: "Hilfe", undo: "Zug zurück", pass: "Passen", resign: "Aufgeben", estimate: "Punkteschätzung", estimateNote: "KataGo-Schätzung, keine endgültige Wertung. Flächen zeigen voraussichtlichen Einfluss.",
  black: "Schwarz", white: "Weiß", even: "Ausgeglichen", points: "Punkte", retry: "Nochmal", continue: "Weiterspielen", show: "Zeigen", hide: "Ausblenden",
  retryPrompt: "Das sieht nach einem großen Nachteil aus. Versuche es nochmal.", resigned: "Du hast aufgegeben.", ended: "Beide haben gepasst. Das Spiel ist beendet; die Schätzung ist keine Endwertung.",
  newGame: "Neues Spiel", error: "Die lokale Berechnung konnte nicht abgeschlossen werden.", retryAnalysis: "Erneut berechnen", invalidMove: "Hier kannst du keinen Stein setzen.",
  labels: { good: "Gut", inaccuracy: "Ungenau", mistake: "Fehler", blunder: "Grober Fehler", uncertain: "Unsicher" }, exceptional: "Starker Zug",
  language: "Coach-Kommentare sind in der Beta auf Deutsch.",
};
const en: typeof de = {
  title: "Play against Coach", beta: "Beta", size: "Board size", start: "Start game", ready: "Choose a board size. You play Black.",
  rating: "The opponent adapts to your playing strength", ratingApproximate: "Strength matching is currently approximate.",
  preparing: "Preparing Coach …", unavailable: "Local KataGo is unavailable on this device.", blocked: "This beta has not been enabled for your account yet.",
  initial: "Place your first stone. I'll look at your moves.", analysing: "Looking at your move …", thinking: "Coach is thinking …", yourTurn: "Your turn", noComment: "I have no reliable comment for this move.",
  help: "Hint", undo: "Undo move", pass: "Pass", resign: "Resign", estimate: "Score estimate", estimateNote: "KataGo estimate, not a final score. Areas show estimated influence.",
  black: "Black", white: "White", even: "Even", points: "points", retry: "Try again", continue: "Continue", show: "Show", hide: "Hide",
  retryPrompt: "This looks like a large disadvantage. Try again.", resigned: "You resigned.", ended: "Both players passed. The game has ended; the estimate is not a final score.",
  newGame: "New game", error: "The local calculation could not be completed.", retryAnalysis: "Retry calculation", invalidMove: "You cannot place a stone here.",
  labels: { good: "Good", inaccuracy: "Inaccuracy", mistake: "Mistake", blunder: "Blunder", uncertain: "Uncertain" }, exceptional: "Strong move",
  language: "Beta coach comments are in German.",
};
export function getCoachCopy(locale: Locale) { return locale === "de" ? de : en; }
