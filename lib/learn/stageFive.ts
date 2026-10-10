import type { LearnLesson } from "./curriculum";
import { b, w, p, t, task, mark, info, sequence } from "./laterLessonTools";
import { attack, bigEndgame, commentedGame, connect, cut, endgameStones, extension, rescue, SAFE_GROUP, tenuki } from "./strategicPositions";

const opening = task("space", 9, [], "black", [p(3, 3), p(4, 4), p(5, 5), p(3, 5), p(5, 3)],
  t("Auf 9×9 wirken frühe Steine bis in die Mitte. Spiele auf einen der zentralen 4-4-Punkte oder in die Mitte.", "On 9×9, early stones reach toward the center. Play a central 4-4 point or the center."),
  t("Der Stein wirkt in mehrere Richtungen. Das ist ein spielbarer Start, nicht der einzig beste Zug.", "The stone works in several directions. This is a playable start, not the only best move."),
  t("Am äußersten Rand wirkt der erste Stein nur in wenige Richtungen. Beanspruche anfangs Raum weiter innen.", "At the very edge, the first stone works in fewer directions. Claim space further inside first."));
const tiger = sequence("tiger", 5, [b(1, 2), b(2, 1)], "black", [
  { move:p(3,2),replies:[p(2,2)],body:t("Ergänze rechts vom Mittelpunkt den dritten schwarzen Stein. Die drei Steine umgreifen dann die Mitte.","Add the third black stone to the right of the center. The three stones then surround the center."),success:t("Diese Form heißt Tigermaul. Weiß ist in die Mitte geschnitten und steht dort im Atari.","This shape is a tiger's mouth. White cut into the center and is in atari there.")},
  { move:p(2,3),body:t("Schlage den weißen Schnittstein auf seiner letzten Freiheit.","Capture the white cutting stone on its last liberty."),success:t("Der Schnitt hält nicht: Schwarz schlägt ihn. Die Form bietet eine taktisch geschützte Verbindung.","The cut does not hold: Black captures it. The shape offers a tactically protected connection.")},
]);
const bambooStones = [b(1,1),b(1,2),b(3,1),b(3,2)];
export const STAGE_FIVE: readonly LearnLesson[] = [
  {id:"s5-opening",stage:5,title:t("Die ersten Züge auf 9×9","First moves on 9×9"),minutes:3,steps:[opening,{...opening,id:"reply",stones:[w(3,3)],targets:[p(5,5),p(5,3),p(3,5),p(4,4)],body:t("Weiß hat links oben begonnen. Beanspruche mit Schwarz noch freien Raum, statt direkt an Weiß anzulegen.","White started at the upper left. Claim open space with Black instead of attaching immediately to White.")}]},
  {id:"s5-too-close",stage:5,title:t("Zu dicht spielen","Playing too close"),minutes:3,steps:[
    info("crowded",9,[b(2,2),b(2,3),b(3,2),b(3,3)],t("Diese vier Steine sichern fast denselben kleinen Bereich. Ein weiterer Stein direkt daneben würde kaum neues Brett erreichen.","These four stones protect almost the same small region. Another stone directly beside them would reach little new board.")),
    extension(9),
  ]},
  {id:"s5-too-far",stage:5,title:t("Zu weit auseinander","Playing too far apart"),minutes:3,steps:[cut(9),connect(9)]},
  {id:"s5-territory-influence",stage:5,title:t("Gebiet und Einfluss","Territory and influence"),minutes:3,steps:[
    mark("points",9,[b(0,2),b(1,2),b(2,2),b(2,1),b(2,0),w(6,6)],[p(0,0),p(1,0),p(0,1),p(1,1)],t("Markiere die vollständig umschlossenen schwarzen Gebietspunkte oben links.","Mark the fully surrounded black territory points at the upper left."),t("Vier konkrete Punkte. Niedrige Steine können den Rand zum Umschließen nutzen.","Four concrete points. Low stones can use the edge to surround territory.")),
    mark("outside",9,[b(3,2),b(3,3),b(3,4),w(6,6)],[p(3,2),p(3,3),p(3,4)],t("Diese Wand hat noch kein geschlossenes Gebiet. Markiere die schwarzen Steine, die nach außen wirken.","This wall has no enclosed territory yet. Mark the black stones facing outward."),t("Die Wand kann nahe Kämpfe unterstützen. Einfluss ist keine Sammlung bereits sicherer Gebietspunkte.","The wall can support nearby fights. Influence is not a collection of already secure territory points."),"stone"),attack(9),
  ]},
  {id:"s5-attack",stage:5,title:t("Angreifen ohne Töten","Attacking without killing"),minutes:3,steps:[attack(9),{...attack(9),id:"other-pressure",targets:[p(6,4),p(5,3)],body:t("Spiele einen Zug, der an Weiß drückt und zugleich an deine schwarze Außenseite anschließt.","Play a move that presses White and also joins your black outside position.")}]},
  {id:"s5-defend",stage:5,title:t("Eigene schwache Gruppen","Your weak groups"),minutes:3,steps:[rescue(9),connect(9)]},
  {id:"s5-urgent",stage:5,title:t("Dringend oder groß?","Urgent or big?"),minutes:3,steps:[rescue(9),tenuki(9)]},
  {id:"s5-tenuki",stage:5,title:t("Woanders spielen / Tenuki","Playing elsewhere / tenuki"),minutes:3,steps:[tenuki(9),rescue(9)]},
  {id:"s5-sente-gote",stage:5,title:t("Sente und Gote","Sente and gote"),minutes:3,steps:[
    ...sequence("force",9,[w(2,2),b(2,1),b(1,2)],"black",[
      {move:p(3,2),replies:[p(2,3)],body:t("Setze Weiß rechts ins Atari. Ohne Antwort würde der Stein geschlagen.","Put White in atari from the right. Without a reply, the stone would be captured."),success:t("Weiß musste erweitern, um diesen Stein zu behalten. Schwarz ist wieder am Zug: Dieser Austausch war Sente.","White had to extend to keep this stone. Black can move again: this exchange was sente.")},
    ]),
    task("quiet",9,[b(2,4),b(4,4)],"black",[p(3,4)],t("Verbinde hier die beiden schwarzen Seiten. Der Zug droht Weiß nichts unmittelbar.","Connect the two black sides here. This move threatens nothing immediately against White."),t("Weiß muss nicht antworten und kann woanders spielen. Ein solcher lokaler Abschluss heißt Gote.","White need not respond and can play elsewhere. Such a local finish is gote."),t("Besetze die Verbindungslücke.","Fill the connecting gap.")),
  ]},
  {id:"s5-shape",stage:5,title:t("Abstand und Verbindung","Spacing and connection"),minutes:3,steps:[extension(9),connect(9)]},
  {id:"s5-empty-triangle",stage:5,title:t("Leeres Dreieck","Empty triangle"),minutes:3,steps:[
    mark("crowded-three",5,[b(1,1),b(2,1),b(1,2)],[p(1,1),p(2,1),p(1,2)],t("Markiere die drei schwarzen Steine um den leeren Eckpunkt des kleinen Dreiecks.","Mark the three black stones around the empty corner of the small triangle."),t("Diese Form heißt leeres Dreieck. Die drei Steine haben zusammen sieben Freiheiten.","This shape is an empty triangle. The three stones have seven liberties together."),"stone"),
    mark("efficient-three",5,[b(1,2),b(2,2),b(3,2)],[p(1,1),p(2,1),p(3,1),p(0,2),p(4,2),p(1,3),p(2,3),p(3,3)],t("Markiere die Freiheiten der geraden Dreiergruppe zum Vergleich.","Mark the straight three-stone group's liberties for comparison."),t("Acht Freiheiten mit ebenfalls drei Steinen. Das Dreieck ist oft weniger effizient, kann beim Verbinden aber nötig sein.","Eight liberties with the same three stones. The triangle is often less efficient, but may be necessary to connect.")),
  ]},
  {id:"s5-tiger-mouth",stage:5,title:t("Tigermaul","Tiger's mouth"),minutes:3,steps:tiger},
  {id:"s5-bamboo",stage:5,title:t("Bambusverbindung","Bamboo joint"),minutes:3,steps:[
    ...sequence("bamboo-top",5,bambooStones,"white",[{move:p(2,1),replies:[p(2,2)],body:t("Versuche als Weiß, oben zwischen die schwarzen Paare zu schneiden.","As White, try cutting between the black pairs at the upper gap."),success:t("Schwarz verbindet durch die andere Lücke. Ein einzelner Schnitt trennt die Paare nicht.","Black connects through the other gap. A single cut does not separate the pairs.")}]),
    ...sequence("bamboo-bottom",5,bambooStones,"white",[{move:p(2,2),replies:[p(2,1)],body:t("Versuche jetzt den unteren Schnitt.","Now try the lower cut."),success:t("Schwarz verbindet diesmal oben. Diese gegenseitig geschützten Verbindungen heißen Bambusverbindung.","Black connects above this time. These mutually protected connections are a bamboo joint.")}]),
  ]},
  {id:"s5-endgame",stage:5,title:t("Die Grenzen fertigstellen","Finishing boundaries"),minutes:3,steps:[info("phase",9,endgameStones(9),t("Hier betrachten wir zwei offene lokale Grenzen. Im Endspiel sind große Kämpfe geklärt; die Züge verändern vor allem die Gebietsränder.","Here we examine two open local boundaries. In the endgame, major fights are settled; moves mainly change territory edges.")),bigEndgame(9)]},
  {id:"s5-big-endgame",stage:5,title:t("Größere Endspielzüge","Larger endgame moves"),minutes:3,steps:[bigEndgame(9),
    mark("four",9,[...endgameStones(9),b(2,0)],[p(0,0),p(1,0),p(0,1),p(1,1)],t("Markiere die vier Punkte, die die geschlossene obere Grenze jetzt umschließt.","Mark the four points now enclosed by the closed upper boundary."),t("Vier Gebietspunkte sind sichtbar eingeschlossen. Zähle beim Vergleichen die leeren Schnittpunkte.","Four territory points are visibly enclosed. Compare by counting empty intersections.")),
  ]},
  {id:"s5-count",stage:5,title:t("Grob zählen","Estimating the score"),minutes:3,steps:[
    mark("black",9,[...SAFE_GROUP,w(8,6),w(7,6),w(6,6),w(6,7),w(6,8)],[p(1,2),p(3,2)],t("Beginne mit den beiden sicheren schwarzen Augenpunkten. Markiere sie.","Start with the two secure black eye points. Mark them."),t("Hier sind zwei schwarze Punkte sicher; offener Raum außerhalb der Gruppe ist noch nicht automatisch Gebiet.","These two black points are secure; open space outside is not automatically territory yet.")),
    mark("white",9,[...SAFE_GROUP,w(8,6),w(7,6),w(6,6),w(6,7),w(6,8)],[p(7,7),p(8,7),p(7,8),p(8,8)],t("Markiere das geschlossene weiße Eckgebiet unten rechts.","Mark White's enclosed lower-right corner territory."),t("Vier weiße Gebietspunkte plus 6,5 Komi, gegenüber zwei sicheren schwarzen Punkten. Die offenen Bereiche bleiben für die Schätzung unentschieden.","Four white territory points plus 6.5 komi, versus two secure black points. The open regions remain undecided in the estimate.")),
  ]},
  {id:"s5-commented-game",stage:5,title:t("Eine 9×9-Partie durchspielen","Walk through a 9×9 game"),minutes:5,steps:commentedGame(9)},
  {id:"s5-win-game",stage:5,title:t("9×9-Abschlussprüfung","9×9 checkpoint"),minutes:10,challenge:true,steps:[{id:"game",kind:"beginner-game",gameSize:9,requireWin:true,body:t("Gewinne eine vollständige 9×9-Partie gegen den GoStone Beginner Bot. Keine Hinweise während der Partie, kein Zurücknehmen.","Win a full 9×9 game against the GoStone Beginner Bot. No hints during play, no undo."),task:t("Bei einer Niederlage kannst du die Lernmomente ansehen und erneut spielen.","After a loss, view the learning moments and try again.")}]},
];
