import type { LessonStep } from "./curriculum";
import type { Position } from "@/lib/game/types";
import { b, w, p, t, task, mark, info, sequence } from "./laterLessonTools";
import { territoryPoints, type LearnStone, boardFromStones } from "./lessonEngine";

export const SAFE_GROUP = [b(0, 1), b(1, 1), b(2, 1), b(3, 1), b(4, 1), b(0, 2), b(2, 2), b(4, 2), b(0, 3), b(1, 3), b(2, 3), b(3, 3), b(4, 3)];
export function corners(size: number) { return [p(2,2),p(3,3),p(2,3),p(3,2)].flatMap(({x,y})=>[p(x,y),p(size-1-x,y),p(x,size-1-y),p(size-1-x,size-1-y)]); }
export function weakStones(size: number): LearnStone[] { return [...SAFE_GROUP, b(size - 4, size - 4), w(size - 5, size - 4), w(size - 4, size - 5), w(size - 3, size - 4)]; }
export function rescue(size: number) { return task("help", size, weakStones(size), "black", [p(size - 4, size - 3)],
  t("Die linke Gruppe hat zwei Augen. Die schwarze Gruppe rechts unten hat nur eine Freiheit; eine neue Ecke kann warten.", "The left group has two eyes. The black group at the lower right has one liberty; a new corner can wait."),
  t("Der Zug gibt der bedrohten Gruppe neue Freiheiten. Die Gruppe mit zwei Augen brauchte keinen weiteren Stein.", "This move gives the threatened group new liberties. The two-eyed group needed no extra stone."),
  t("Der Zug anderswo verliert die bedrohte Gruppe. Nimm ihren letzten freien Nachbarn.", "Playing elsewhere loses the threatened group. Play on its last empty neighbor.")); }
export function connect(size: number) { return task("join", size, [b(2, 4), b(4, 4), w(3, 3)], "black", [p(3, 4)],
  t("Weiß steht über der Lücke. Ohne Antwort kann Weiß die beiden schwarzen Seiten trennen.", "White is above the gap. Without a reply, White can separate the two black sides."),
  t("Der Zug verbindet direkt. Wenn ein Schnitt droht, ist die sichere Verbindung wichtiger als großer Abstand.", "This move connects directly. When a cut threatens, a secure connection matters more than wide spacing."),
  t("Die beiden Seiten bleiben getrennt. Besetze ihre gemeinsame Lücke.", "The two sides remain separate. Fill their shared gap.")); }
export function cut(size: number) { return task("cut", size, [w(2, 4), w(4, 4), b(3, 3), b(3, 5)], "black", [p(3, 4)],
  t("Weiß hat zwischen den Steinen einen freien Punkt gelassen. Schwarz kann dort verbinden und Weiß getrennt halten.", "White left an empty point between its stones. Black can connect there and keep White separated."),
  t("Schwarz ist verbunden; Weiß bleibt in zwei Gruppen. Ein weiter Abstand kontrolliert Raum, erlaubt aber Schnitte.", "Black is connected; White remains two groups. Wide spacing controls space but allows cuts."),
  t("Dieser Zug besetzt nicht die weiße Verbindung. Suche die Lücke zwischen Weiß.", "This move does not occupy White's connection. Look for the gap between White's stones.")); }
export function extension(size: number) { return task("extend", size, [b(2, 2), b(2, 3), w(size - 3, size - 3)], "black", [p(2, 5), p(2, 6)],
  t("Zwei schwarze Steine stehen an der linken Seite. Lass ein oder zwei freie Punkte bis zur Erweiterung – nicht direkt daneben.", "Two black stones stand on the left side. Leave one or two empty points before extending—not immediately beside them."),
  t("Der neue Stein beansprucht zusätzlichen Raum an der Seite. Der Abstand ist keine feste Regel: Gegnerische Steine können eine engere Verbindung nötig machen.", "The new stone claims extra space on the side. Spacing is not a fixed rule: enemy stones may require a closer connection."),
  t("Dieser Abstand ist für die gezeigte Seitenstellung zu eng oder zu weit. Spiele auf der dritten Linie weiter unten.", "This distance is too close or too wide for this side position. Play further down the third line.")); }
export function approach(size: number) { return task("approach", size, [w(3, 3)], "black", [p(2, 5), p(5, 2)],
  t("Weiß hat die linke obere Ecke besetzt. Nähere dich auf der dritten Linie von einer Seite.", "White occupied the upper-left corner. Approach from either side on the third line."),
  t("Der Annäherungszug lässt Weiß die Ecke nicht ungestört ausbauen. Beide gezeigten Richtungen sind hier spielbar.", "The approach prevents White from developing the corner undisturbed. Both shown directions are playable here."),
  t("Direkt neben Weiß beginnst du einen engen Kampf. Nähere dich mit etwas Abstand auf der dritten Linie.", "Playing immediately next to White starts a cramped fight. Approach with some space on the third line.")); }
export function framework(size: number): LearnStone[] { return [w(size - 4, 3), w(size - 4, size - 4), w(size - 7, 3), w(size - 7, size - 4), b(2, 3)]; }
export function reduction(size: number) { return task("reduce", size, framework(size), "black", [p(size - 8, 5), p(size - 8, 6)],
  t("Die weißen Steine rahmen rechts möglichen Raum ein. Spiele von deiner schwarzen Seite an den offenen Rand dieses Rahmens.", "White frames potential space on the right. Play from your black side at the open edge of that framework."),
  t("Schwarz begrenzt den weißen Raum von außen, ohne tief hineinzugehen. Das heißt Reduction oder Verkleinerung.", "Black limits White's space from outside without going deep inside. This is a reduction."),
  t("Ein tiefer Zug müsste im weißen Einfluss selbst überleben. Gesucht ist der offene Rand zur schwarzen Seite.", "A deep move would need to survive inside White's influence. Look for the open edge facing Black.")); }
export function invasion(size: number): LessonStep[] { return sequence("invasion", size, [w(3, 3)], "black", [
  { move: p(2, 2), replies: [p(3, 2)], body: t("Weiß hat den 4-4-Punkt. Spiele am 3-3-Punkt näher am oberen linken Eck.", "White occupies the 4-4 point. Enter at the 3-3 point closer to the upper-left corner."), success: t("Schwarz ist in der weißen Ecke. Der einzelne Stein lebt noch nicht sicher.", "Black is inside White's corner. The single stone is not securely alive yet.") },
  { move: p(2, 3), replies: [p(3, 4)], body: t("Weiß blockiert rechts. Erweitere entlang der linken Seite.", "White blocks on the right. Extend along the left side."), success: t("Schwarz gewinnt Raum am Rand; Weiß erhält Steine nach außen. Das sind verschiedene Gewinne.", "Black gains room along the edge; White gets outward-facing stones. These are different gains.") },
  { move: p(2, 4), replies: [p(3, 5)], body: t("Erweitere noch einmal nach unten, statt in Weiß hineinzulaufen.", "Extend downward again instead of running into White."), success: t("Die Invasion braucht Augenraum oder einen Ausgang. Diese Fortsetzung zeigt einen Anfang, noch keine fertige lebendige Gruppe.", "An invasion needs eye space or an exit. This continuation is a start, not a finished living group.") },
]); }
export function attack(size: number) { return task("press", size, [b(6, 2), b(7, 2), b(6, 3), b(7, 3), w(5, 4), w(5, 5)], "black", [p(6, 4), p(5, 3)],
  t("Die weiße Zweiergruppe hat noch viele Freiheiten. Drücke sie von der Seite deiner schwarzen Steine weg.", "The white pair still has many liberties. Push it away from your black stones."),
  t("Der Angriff baut zugleich deine schwarze Außenseite aus. Weiß ist dadurch nicht automatisch tot.", "The attack also develops Black's outside position. It does not automatically make White dead."),
  t("Greife von deiner vorhandenen schwarzen Stärke aus an. Ein isolierter Angreifer wäre selbst schwach.", "Attack from your existing black strength. An isolated attacker would be weak itself.")); }
export function tenuki(size: number) { return task("elsewhere", size, [...SAFE_GROUP, w(5, 2), w(size - 4, size - 4)], "black", [p(2, size - 3), p(3, size - 4)],
  t("Weiß nähert sich links deiner Gruppe mit zwei Augen. Sie kann nicht mehr geschlagen werden. Unten links ist noch eine freie Ecke.", "White approaches your two-eyed group on the left. It cannot be captured anymore. The lower-left corner is still empty."),
  t("Du spielst woanders: Tenuki. Die sichere Gruppe brauchte keine Antwort auf den letzten weißen Zug.", "You play elsewhere: tenuki. The secure group needed no response to White's last move."),
  t("Die Gruppe links lebt bereits. Besetze Raum in der freien Ecke unten links.", "The left group is already alive. Claim space in the empty lower-left corner.")); }
export function endgameStones(size: number): LearnStone[] { return [b(0, 2), b(1, 2), b(2, 2), b(2, 1), b(size - 2, size - 1), b(size - 1, size - 3), w(5, 3)]; }
export function bigEndgame(size: number) { return task("larger-boundary", size, endgameStones(size), "black", [p(2, 0)],
  t("Oben links kann Schwarz vier leere Punkte einschließen, unten rechts nur einen. Schließe den größeren Bereich.", "Black can enclose four empty points at the upper left, but only one at the lower right. Close the larger region."),
  t("Die obere Grenze umschließt vier Gebietspunkte. Ein Zug unten rechts hätte nur einen eingeschlossen.", "The upper boundary encloses four territory points. A move at the lower right would have enclosed only one."),
  t("Vergleiche nur die freien Punkte hinter der jeweiligen Grenze, nicht die Zahl der Randsteine.", "Compare the empty points behind each boundary, not the number of boundary stones.")); }

export function settledTeachingBoard(size: number): LearnStone[] {
  const half = (size - 1) / 2;
  const stones: LearnStone[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < half; x++) {
    if (x === half - 1 || x % 2 === 1 || (y >= 2 && y % 2 === 0)) stones.push(b(x,y),w(size-1-x,size-1-y));
  }
  return stones;
}

/** An authored, symmetric teaching record, not a bot or an engine-best-game claim. */
export function commentedGame(size: 9 | 13): LessonStep[] {
  const half = (size - 1) / 2;
  const black: Position[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < half; x++) if (x % 2 === 1 || (y >= 2 && y % 2 === 0)) black.push(p(x, y));
  const preferred = [p(3, 3), p(3, 5), p(1, 3), p(1, 2), p(3, 2)];
  const moves = [...preferred, ...black.filter((point) => !preferred.some((first) => first.x === point.x && first.y === point.y))];
  const turns = moves.map((move, index) => ({ move, replies: [p(size - 1 - move.x, size - 1 - move.y)] as (Position | null)[],
    body: [t("Diese Beispielpartie beginnt leer. Setze Schwarz am 4-4-Punkt oben links; Weiß besetzt die gegenüberliegende Ecke.", "This example game starts empty. Play Black at the upper-left 4-4 point; White takes the opposite corner."),
      t("Erweitere Schwarz auf derselben Seitenlinie zwei Punkte nach unten. Weiß erweitert gegenüber.", "Extend Black two points down the same side line. White extends on the opposite side."),
      t("Schwarz beansprucht links mehr Raum. Spiele auf derselben Höhe wie der erste Stein, näher am linken Rand.", "Black claims more space on the left. Play level with the first stone, closer to the left edge."),
      t("Verbinde den neu gesetzten Seitenstein nach oben. Getrennte Gruppen brauchen getrennte Verteidigung.", "Connect the new side stone upward. Separate groups need separate defense."),
      t("Schließe die Lücke über dem ersten Eckstein. Danach siehst du, wie beide Seiten Augen und Grenzen fertigstellen.", "Close the gap above the first corner stone. Then see both sides finish eyes and boundaries.")][Math.min(index, 4)],
    success: t("Die Stellung bleibt aus derselben Partie erhalten. Weiß hat geantwortet.", "The position is retained from the same game. White has replied.") }));
  const decisions = turns.slice(0, 5);
  decisions[4] = { ...decisions[4], replies: [...decisions[4].replies, ...turns.slice(5).flatMap((turn) => [turn.move, ...turn.replies]), null, null] };
  const steps = sequence(`record-${size}`, size, [], "black", decisions);
  const terminal = [...moves.map(({x,y})=>b(x,y)), ...moves.map(({x,y})=>w(size-1-x,size-1-y))];
  return [...steps.map((step, index) => ({ ...step, emphasis: step.targets,
    success: index === 4 ? t("Beide Seiten haben ihre Grenzen geschlossen und zweimal gepasst. Der mittlere Streifen berührt beide Farben und ist neutral.", "Both sides closed their boundaries and passed twice. The central strip touches both colors and is neutral.") : step.success })),
    { ...mark("count-black", size, terminal, territoryPoints(boardFromStones(size, terminal), "black"), t("Tippe einen leeren Punkt in einem schwarzen Gebiet an.", "Tap an empty point inside Black's territory."), t("Gezählt werden leere Gebietspunkte und Gefangene. Weiß bekommt zusätzlich 6,5 Komi; in dieser symmetrischen Partie gewinnt Weiß dadurch.", "Count empty territory points and prisoners. White gets an additional 6.5 komi; it wins this symmetric game by that amount.")), selectionCount: 1 },
    info("record-purpose", size, terminal, t("Diese vereinfachte Beispielpartie zeigt den Ablauf bis zur Wertung, keine ideale Strategie. In echten Partien kann der Gegner offene Räume angreifen oder besetzen.", "This simplified example shows the flow through scoring, not ideal strategy. In real games, the opponent can attack or occupy open spaces.")),
  ];
}
