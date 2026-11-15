import type { LessonStep } from "./curriculum";
import { b, w, p, t, sequence, NET, SNAPBACK } from "./laterLessonTools";

const netLine = sequence("net-practice", 5, NET, "black", [
  { move: p(2, 2), replies: [p(2, 1)], body: t("Weiß hat zwei Ausgänge. Schließe beide mit einem diagonalen Netz ein; Weiß versucht anschließend zu fliehen.", "White has two exits. Enclose both with a diagonal net; White then tries to escape."), success: t("Weiß hat erweitert. Versperre den neuen Ausgang am Rand.", "White extended. Block the new exit at the edge.") },
  { move: p(2, 0), replies: [p(1, 2)], body: t("Nimm die neue Freiheit am Rand. Weiß kann dann nur noch in die andere Richtung erweitern.", "Take the new edge liberty. White can then extend only in the other direction."), success: t("Weiß hat jetzt nur noch eine Freiheit.", "White now has only one liberty.") },
  { move: p(0, 2), body: t("Fülle die letzte Freiheit der weißen Gruppe.", "Fill the white group's last liberty."), success: t("Alle drei weißen Steine werden geschlagen. Das Netz hat beide Fluchtwege eingeschlossen.", "All three white stones are captured. The net enclosed both escape routes.") },
]);

const widerNet = sequence("wider-net", 7, [w(1, 1), w(2, 1), b(0, 1), b(1, 0), b(2, 0), b(4, 1), b(1, 3), b(2, 3)], "black", [
  { move: p(3, 2), replies: [p(3, 1)], body: t("Die weiße Zweiergruppe hat drei Freiheiten. Stelle ein Netz diagonal vor ihren äußeren Ausgang.", "The white pair has three liberties. Place a net diagonally ahead of its outer exit."), success: t("Weiß läuft zur Seite. Der neue Randpunkt bleibt innerhalb deines Netzes.", "White runs sideways. The new edge point remains inside your net.") },
  { move: p(3, 0), replies: [p(2, 2)], body: t("Schließe den Ausweg am oberen Rand. Weiß versucht danach nach unten zu entkommen.", "Close the exit at the top edge. White then tries to escape downward."), success: t("Die vier weißen Steine haben gemeinsam nur noch eine Freiheit.", "The four white stones now share just one liberty.") },
  { move: p(1, 2), body: t("Nimm die letzte Freiheit links neben dem neuen weißen Stein.", "Take the last liberty to the left of the new white stone."), success: t("Vier Steine werden geschlagen. Auch die größere Gruppe konnte die Umfassung nicht verlassen.", "Four stones are captured. The larger group could not escape the enclosure either.") },
]);

export const NET_PRACTICE = [...netLine, ...widerNet];

export const SNAPBACK_PRACTICE: LessonStep[] = sequence("snap-practice", 5, SNAPBACK, "black", [
  {
    move: p(1, 0), replies: [p(0, 0)],
    body: t("Setze zwischen den weißen Steinen am oberen Rand. Wie viele Freiheiten hat Weiß, wenn es deinen Stein schlägt?", "Play between the white stones on the top edge. How many liberties will White have after taking your stone?"),
    success: t("Weiß hat deinen Stein geschlagen. Die jetzt verbundene weiße Gruppe hat nur eine Freiheit.", "White took your stone. The newly connected white group has only one liberty."),
  },
  {
    move: p(1, 0),
    body: t("Schlage am gerade frei gewordenen Punkt zurück.", "Recapture at the point just emptied."),
    success: t("Ein schwarzer Stein gegen drei weiße. Der sofortige Rückschlag ist legal, weil eine andere Stellung entsteht.", "One black stone for three white stones. Immediate recapture is legal because the position changes."),
  },
]);
