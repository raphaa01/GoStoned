import type { LessonStep } from "./curriculum";
import type { Position } from "@/lib/game/types";
import { b, w, p, t, sequence, NET, SNAPBACK } from "./laterLessonTools";

/** Rotate every part of an authored task, including ko and teaching replies.
 * Copy for these exercises deliberately refers to groups/liberties, not screen directions. */
export function rotatePractice(steps: readonly LessonStep[], quarterTurns: number, prefix: string): LessonStep[] {
  return steps.map((step) => {
    const point = (initial: Position): Position => {
      let result = initial;
      for (let turn = 0; turn < quarterTurns; turn++) result = p(step.size! - 1 - result.y, result.x);
      return result;
    };
    return { ...step, id: `${prefix}-${step.id}`,
      stones: step.stones?.map((stone) => ({ ...point(stone), color: stone.color })),
      koPreviousBoard: step.koPreviousBoard?.map((stone) => ({ ...point(stone), color: stone.color })),
      targets: step.targets?.map(point), replies: step.replies?.map((reply) => reply === null ? null : point(reply)),
      emphasis: step.emphasis?.map(point), territory: step.territory?.map(point), group: step.group?.map(point),
      hintArea: step.hintArea?.map(point), lastMove: step.lastMove ? point(step.lastMove) : undefined,
    };
  });
}

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

export const NET_PRACTICE = [
  ...netLine,
  ...rotatePractice(netLine, 1, "right"),
  ...rotatePractice(netLine, 2, "bottom"),
  ...rotatePractice(netLine, 3, "left"),
  ...widerNet,
];

function snapLine(larger = false): LessonStep[] {
  const stones = larger ? [...SNAPBACK.filter((stone) => stone.x !== 0 || stone.y !== 2), w(0, 2), b(0, 3)] : SNAPBACK;
  return sequence(larger ? "four-snapback" : "snap-practice", 5, stones, "black", [
    { move: p(1, 0), replies: [p(0, 0)], body: t("Ein eigener Stein kann den Rückschlag vorbereiten. Wirf zwischen den weißen Steinen ein und prüfe ihre Freiheiten nach der Antwort.", "One own stone can prepare a recapture. Throw in between the white stones and check their liberties after the reply."), success: t("Weiß hat deinen Stein geschlagen. Die neue weiße Gruppe hat nur eine Freiheit auf dem gerade frei gewordenen Punkt.", "White captured your stone. The new white group has only one liberty, at the point just emptied.") },
    { move: p(1, 0), body: t("Schlage auf dem gerade frei gewordenen Punkt zurück.", "Recapture at the point just emptied."), success: larger ? t("Ein schwarzer Stein gegen vier weiße: Der Rückschlag erzeugt eine andere Stellung, deshalb ist es kein Ko.", "One black stone for four white stones: the recapture creates a different position, so it is not ko.") : t("Ein schwarzer Stein gegen drei weiße. Der sofortige Rückschlag ist legal: Es entsteht nicht wieder dieselbe Stellung.", "One black stone for three white stones. Immediate recapture is legal: it does not restore the same position.") },
  ]);
}
const snap = snapLine();
export const SNAPBACK_PRACTICE = [
  ...snap,
  ...rotatePractice(snap, 1, "right"),
  ...rotatePractice(snap, 2, "bottom"),
  ...rotatePractice(snap, 3, "left"),
  ...snapLine(true),
];
