# GoStone-Impressum konfigurieren

Diese Checkliste geht von einem in Deutschland niedergelassenen Betreiber aus.
Bei einem anderen Sitz muss das Impressum vor der Veröffentlichung für das
jeweilige Land neu geprüft werden. Reale Betreiberdaten gehören ausschließlich
in die Vercel-Umgebungsvariablen und niemals in Git, `.env.example`, Tickets oder
Screenshots.

## Mindestangaben für eine natürliche Person

Für einen öffentlich angebotenen Dienst wie GoStone werden mindestens folgende
Angaben veröffentlicht:

- `LEGAL_NAME`: vollständiger bürgerlicher Vor- und Nachname des Betreibers;
  „GoStone“ oder ein Benutzername reicht nicht aus.
- `LEGAL_STREET`: Straße und Hausnummer einer zustellfähigen Anschrift.
- `LEGAL_CITY`: Postleitzahl und Ort.
- `LEGAL_EMAIL`: dauerhaft erreichbare und regelmäßig gelesene Kontaktadresse.

`LEGAL_COUNTRY` ist bei einer deutschen Anschrift auf der deutschen Seite nicht
zwingend, vermeidet aber auf der englischen Seite und bei grenzüberschreitender
Nutzung Unklarheiten. Eine geschäftliche E-Mail-Adresse darf statt einer privaten
Adresse verwendet werden.

Eine Telefonnummer ist nicht ausnahmslos vorgeschrieben. Der Europäische
Gerichtshof verlangt neben der E-Mail aber eine weitere schnelle, unmittelbare
und wirksame Kontaktmöglichkeit; das kann beispielsweise eine Telefonnummer oder
ein zeitnah beantwortetes elektronisches Kontaktformular sein. Solange GoStone
kein allgemeines Kontaktformular anbietet, ist `LEGAL_PHONE` deshalb die
risikoärmere Variante. Dafür kann eine getrennte geschäftliche Rufnummer statt
der privaten Mobilnummer verwendet werden.

GoStone verwendet wegen des gespeicherten Spieler-Chats dieselbe erreichbare
Adresse zugleich als Kontaktstelle nach Art. 11 und 12 DSA. Nur wenn dafür ein
getrenntes, ebenfalls überwachtes Postfach besteht, wird `LEGAL_DSA_EMAIL`
gesetzt. Anfragen müssen tatsächlich auf Deutsch und Englisch bearbeitet werden
können, solange beide Sprachen im Impressum zugesagt werden.

## Nur angeben, wenn es tatsächlich zutrifft

| Sachverhalt | Umgebungsvariablen |
| --- | --- |
| Juristische Person oder eingetragene Gesellschaft | `LEGAL_ENTITY_DETAILS` mit Rechtsform und vertretungsberechtigter Person |
| Eintrag im Handels-, Vereins-, Partnerschafts- oder Genossenschaftsregister | `LEGAL_REGISTER_NAME` und `LEGAL_REGISTER_NUMBER` |
| Erteilte Umsatzsteuer-Identifikationsnummer | `LEGAL_VAT_ID` |
| Erteilte Wirtschafts-Identifikationsnummer | `LEGAL_BUSINESS_ID` |
| Behördlich erlaubnispflichtige Tätigkeit | `LEGAL_SUPERVISORY_AUTHORITY` |
| Journalistisch-redaktionelles Angebot | `LEGAL_EDITORIAL_NAME`, `LEGAL_EDITORIAL_STREET` und `LEGAL_EDITORIAL_CITY` für die verantwortliche Person |

Die persönliche Steuernummer ist **keine** Umsatzsteuer-Identifikationsnummer
und gehört nicht in das Impressum. Register- und Kennnummern dürfen nicht
erfunden oder vorsorglich durch Platzhalter ersetzt werden.

Bei einer journalistisch-redaktionell verantwortlichen Person gelten zusätzlich
die persönlichen Voraussetzungen aus § 18 Abs. 2 MStV. Eine reine Spiel-, Regel-
oder Hilfeseite ist nicht allein deshalb journalistisch-redaktionell; ein
regelmäßig redaktionell betreuter News-, Blog- oder Pressebereich kann die
Einordnung dagegen ändern.

Unternehmer müssen außerdem § 36 VSBG prüfen. Die allgemeine Erklärung zur
Teilnahme an Verbraucherschlichtung entfällt grundsätzlich, wenn am 31. Dezember
des Vorjahres höchstens zehn Personen beschäftigt waren und keine freiwillige
oder gesetzliche Teilnahmeverpflichtung besteht. Weil diese Tatsachen nicht aus
dem Repository hervorgehen, erzeugt GoStone hierzu keine Behauptung. Der frühere
Link zur EU-Online-Streitbeilegungsplattform darf nicht ergänzt werden: Die
zugrunde liegende Verordnung ist seit dem 20. Juli 2025 aufgehoben.

## Nicht für das Impressum benötigt

Folgende persönliche Angaben werden für das hier beschriebene Impressum nicht
benötigt und sollen nicht veröffentlicht werden:

- Geburtsdatum oder Geburtsort;
- Ausweis-, Pass- oder Führerscheindaten;
- Nationalität, Foto oder Unterschrift;
- Bankverbindung oder Zahlungsdaten;
- persönliche Steuernummer;
- private Mobilnummer, wenn eine geeignete geschäftliche Kontaktmöglichkeit
  bereitsteht;
- private E-Mail-Adresse, wenn ein dauerhaft überwachtes geschäftliches Postfach
  verwendet wird.

Die Wohnanschrift lässt sich nur dann vermeiden, wenn eine andere echte,
zustellfähige Niederlassungs- oder Geschäftsanschrift des Betreibers besteht.
Ein bloßes Postfach ersetzt die erforderliche Anschrift nicht. Vor der Nutzung
einer c/o-, Büroservice- oder virtuellen Adresse sollte individuell geprüft
werden, ob der Betreiber dort tatsächlich niedergelassen und rechtlich sicher
erreichbar ist.

## Primärquellen

- [§ 5 DDG – Allgemeine Informationspflichten](https://www.gesetze-im-internet.de/ddg/__5.html)
- [§ 18 MStV – Informationspflichten](https://www.gesetze-bayern.de/Content/Document/MStV-18)
- [EuGH, Urteil C-298/07 – weitere schnelle Kontaktmöglichkeit neben E-Mail](https://eur-lex.europa.eu/legal-content/DE/ALL/?uri=CELEX:62007CJ0298)
- [Art. 11 und 12 der Verordnung (EU) 2022/2065 – DSA-Kontaktstellen](https://eur-lex.europa.eu/eli/reg/2022/2065/oj)
- [§ 36 VSBG – Verbraucherstreitbeilegung](https://www.gesetze-im-internet.de/vsbg/__36.html)
- [Verordnung (EU) 2024/3228 – Aufhebung der ODR-Verordnung](https://eur-lex.europa.eu/eli/reg/2024/3228/oj)

Diese technische Umsetzung minimiert die veröffentlichten Daten, kann aber die
rechtliche Einordnung des konkreten Betreibers und Geschäftsmodells nicht
garantieren. Vor einem geschäftlichen oder monetarisierten Start sollte die
fertig befüllte Seite anwaltlich geprüft werden. Eine Datenschutzerklärung ist
ein separates Pflichtdokument und wird durch das Impressum nicht ersetzt.
