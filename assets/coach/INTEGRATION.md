# GoStone Sprachtrainer v5

Dieses Paket enthält das vollständige zusätzliche Trainermodell, keinen
Adapter mit einer externen Sprachmodell-Abhängigkeit. KataGo bleibt separat.

ONNX-Eingaben: context float32 [batch,63], tokens int64 [batch,length],
reason int64 [batch], board float32 [batch,11,19,19]. Das Brett enthält die
Steine vor/nach dem Zug, die simulierte Alternative, Zugpunkte und Brettmasken.
Die genaue Reihenfolge und Normalisierung der Merkmale und Gründe steht
in schema.json. Die Ausgabe enthält Textlogits und Grundlogits. Wähle nur
Gründe, die durch die externe Brettanalyse belegt sind. Schwere Fehler und
Rücknahmefragen müssen durch diese Analyse entschieden werden.

Tokens: 0 PAD, 1 BOS, 2 EOS, 3..258 UTF-8-Bytes (Bytewert plus 3),
ab 259 die Wörter aus tokenizer.json. Die Wörter werden ohne automatisch
ergänzte Leerzeichen aneinandergereiht; Leerzeichen sind Byte-Tokens.
Die Generierung beginnt mit BOS und endet mit EOS. Nicht belegte Aussagen
verwerfen; Kontext, Markierungen und Varianten liefert die Brettanalyse.

Die Anwendung begrenzt die Generierung auf freigegebene kurze Sätze aus
tokenizer.json (phrases). VOR der Auswahl für jeden Text phraseRules prüfen:
quality muss stimmen (oder die Bewertung muss in qualities enthalten sein),
und facts muss eine Teilmenge der aktuellen verifizierten
played:/alternative:-Belege sein. zones werden aus den Markierungen als
top/middle/bottom und left/centre/right berechnet (Drittel der Brettgröße).
numbers und alternativeNumbers binden nur die jeweils genannten Werte an die
aktuellen Statistiken. Ein Artikel wie "ein Gebiet" bindet keine Zahlen.
Neutrale physische Folgen können bei anderen Zugbewertungen wahr bleiben;
das ist kein Lob für den Gesamtzug. Nicht erfüllte Voraussetzungen sperren den Text.
Ohne gültigen Text wird kein Modellkommentar erzeugt; keine Vorlagen ergänzen.
Tokenweise Beam-Suche im Präfixbaum dieser Sätze
verwendet die Sprachmodell-Wahrscheinlichkeiten. Neue freigegebene eigene
Kommentare erweitern diese Sprachgrammatik beim nächsten Trainingsabschnitt.
Eigene freie Erklärungen (human_insight) dürfen nur für ihre gespeicherte
Originalstellung (source=human, reason=human_insight), ihren Zug und dieselbe
Bewertung gewählt werden. Normale Spielzüge verwenden nur belegte Gründe.
tokenizer.json
enthält dazu manualExamples: Text -> Liste von SHA-256-Kontextschlüsseln.
Der Schlüssel ist SHA-256 über UTF-8-JSON mit sortierten Schlüsseln und ohne
Leerzeichen, aus before (size und moves), move, judgement und facts (sortierte
belegte Kandidatengründe ohne human_insight). Bei älteren Paketen ohne diese
Zuordnung ist human_insight für neue Spielstellungen gesperrt. Ein vorhandener
Text im Satzvorrat allein bestätigt seine Anwendbarkeit nicht.
Auch neu verfasste, automatisch geprüfte Kommentare des lokalen größeren
Sprachlehrers werden mit der tatsächlichen Brettstellung als vollständige
Zielsequenzen trainiert. Nur Texte aus Trainingspartien erweitern die Grammatik.
Der größere Lehrer wird zum Ausführen dieses exportierten Modells nicht benötigt.
Das ist ein spezialisierter Kommentardecoder, kein frei antwortender Chatbot.
Go-Lehrer: LoGos-7B; deutsche Formulierung: Qwen3.5-9B. Vorprogrammierte
Sprachübungen sind kein Bestandteil dieser Lehrer-Trainingsläufe.
Die gemessene Rohtextquote bezieht sich auf die unbeschränkte Generierung;
sie ist keine Bewertung der pädagogischen Qualität der erlaubten Sätze.

weights.pt ist der gleiche Modellstand für die lokale PyTorch-Anwendung.
coach.onnx ist beim vollständigen Export zusätzlich enthalten und numerisch
gegen PyTorch geprüft. Manifest, Tokenizer und Schema zusammen verwenden.

Das Modell ist ein Pilot. Eine automatische Textprüfung oder ein niedriger
Sprachverlust bestätigt keine menschliche Go-Trainerqualität.
