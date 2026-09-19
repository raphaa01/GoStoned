import type { Locale } from "./config";

export type BeginnerGuideCopy = Readonly<{
  onboarding: Readonly<{
    kicker: string;
    canPlayTitle: string;
    canPlayBody: string;
    canPlayYes: string;
    canPlayNo: string;
    rankTitle: string;
    rankBody: string;
    rankLabel: string;
    rankPlaceholder: string;
    useRank: string;
    skipRank: string;
    tutorialOfferTitle: string;
    tutorialOfferBody: string;
    startTutorial: string;
    skipTutorial: string;
    back: string;
    cancel: string;
    creating: string;
    tutorialTitle: string;
    stepLabel: string;
    previous: string;
    next: string;
    finish: string;
    openLessons: string;
  }>;
  slides: readonly Readonly<{
    title: string;
    body: string;
    note: string;
  }>[];
  scoring: Readonly<{
    kicker: string;
    title: string;
    intro: string;
    scoreTitle: string;
    scoreBody: string;
    deadTitle: string;
    deadBody: string;
    confirmTitle: string;
    confirmBody: string;
    disputeTitle: string;
    disputeBody: string;
    understood: string;
    hideNextTime: string;
    reopen: string;
  }>;
}>;

const en: BeginnerGuideCopy = {
  onboarding: {
    kicker: "A quick start",
    canPlayTitle: "Do you already know how to play Go?",
    canPlayBody: "Your answer only helps us choose the right starting point.",
    canPlayYes: "Yes, I can play",
    canPlayNo: "No, I am new",
    rankTitle: "Do you know your approximate kyu rank?",
    rankBody: "If you know it, we can set a more suitable provisional starting rating. You can also continue without one.",
    rankLabel: "Approximate kyu rank",
    rankPlaceholder: "Select a rank",
    useRank: "Continue with this rank",
    skipRank: "Continue without a rank",
    tutorialOfferTitle: "Would you like a two-minute introduction?",
    tutorialOfferBody: "Six short steps cover the goal, captures, passing and scoring.",
    startTutorial: "Show me the introduction",
    skipTutorial: "I will start without it",
    back: "Back",
    cancel: "Back to account form",
    creating: "Creating your account…",
    tutorialTitle: "Go in six steps",
    stepLabel: "Step {current} of {total}",
    previous: "Previous",
    next: "Next",
    finish: "Finish",
    openLessons: "Continue with the lessons",
  },
  slides: [
    {
      title: "Surround more than your opponent",
      body: "Black and White take turns placing stones on the intersections. You are trying to surround empty space as your territory.",
      note: "The player with more points at the end wins.",
    },
    {
      title: "Place one stone per turn",
      body: "A placed stone stays where it is. Stones of the same colour that touch along an edge form one connected group.",
      note: "Diagonals do not connect stones.",
    },
    {
      title: "Open neighbours are liberties",
      body: "Every empty intersection directly beside a stone is a liberty. If a stone or group loses its last liberty, it is captured and removed.",
      note: "Surround opposing stones to capture them.",
    },
    {
      title: "Protect groups with space",
      body: "Connected stones share liberties. A group that can make two separate enclosed spaces—called eyes—cannot be captured.",
      note: "At first, keep your groups connected and give them room.",
    },
    {
      title: "Pass when there is nothing useful left",
      body: "You do not have to place a stone. Choose Pass when another move would not help. After both players pass in a row, scoring begins.",
      note: "Passing does not mean resigning.",
    },
    {
      title: "Check the final position together",
      body: "Territory and captured or dead stones determine the score; White also receives komi. Mark dead groups, then both players confirm the same position.",
      note: "If you disagree, continue playing to settle the group. The lessons let you practise all of this on a board.",
    },
  ],
  scoring: {
    kicker: "After two passes",
    title: "Check the final score together",
    intro: "The numbers are provisional until both players agree on the same final position.",
    scoreTitle: "Read the numbers",
    scoreBody: "Black and White show the current point totals. Open “Score breakdown” to see territory, prisoners and komi.",
    deadTitle: "Mark dead groups",
    deadBody: "Tap one stone in every group that cannot escape. The whole connected group is marked. Tap it again to restore it.",
    confirmTitle: "If everything looks right",
    confirmBody: "Choose “Confirm final score”. The game ends only after both players confirm the same position.",
    disputeTitle: "If you disagree",
    disputeBody: "Select the marked group under “Dispute a marked group” and continue play. Settle it on the board, then both pass again.",
    understood: "Understood",
    hideNextTime: "Do not show automatically again",
    reopen: "How scoring works",
  },
};

const de: BeginnerGuideCopy = {
  onboarding: {
    kicker: "Kurz einrichten",
    canPlayTitle: "Kannst du schon Go spielen?",
    canPlayBody: "Deine Antwort hilft uns nur dabei, den passenden Einstieg zu wählen.",
    canPlayYes: "Ja, ich kann spielen",
    canPlayNo: "Nein, ich bin neu",
    rankTitle: "Kennst du ungefähr deinen Kyu-Rang?",
    rankBody: "Wenn du ihn kennst, können wir deine vorläufige Startwertung passender setzen. Du kannst auch ohne Angabe weitergehen.",
    rankLabel: "Ungefährer Kyu-Rang",
    rankPlaceholder: "Rang auswählen",
    useRank: "Mit diesem Rang weiter",
    skipRank: "Ohne Rang weiter",
    tutorialOfferTitle: "Möchtest du eine zweiminütige Einführung?",
    tutorialOfferBody: "Sechs kurze Schritte erklären Ziel, Schlagen, Passen und Wertung.",
    startTutorial: "Einführung ansehen",
    skipTutorial: "Direkt loslegen",
    back: "Zurück",
    cancel: "Zurück zur Kontoerstellung",
    creating: "Dein Konto wird erstellt…",
    tutorialTitle: "Go in sechs Schritten",
    stepLabel: "Schritt {current} von {total}",
    previous: "Zurück",
    next: "Weiter",
    finish: "Fertig",
    openLessons: "Weiter zu den Lektionen",
  },
  slides: [
    {
      title: "Umschließe mehr als dein Gegner",
      body: "Schwarz und Weiß setzen abwechselnd Steine auf die Schnittpunkte. Ziel ist, freie Fläche als eigenes Gebiet zu umschließen.",
      note: "Wer am Ende mehr Punkte hat, gewinnt.",
    },
    {
      title: "Setze pro Zug einen Stein",
      body: "Ein gesetzter Stein bleibt liegen. Gleichfarbige Steine, die sich an einer Kante berühren, bilden eine verbundene Gruppe.",
      note: "Diagonal berührte Steine sind nicht verbunden.",
    },
    {
      title: "Freie Nachbarpunkte heißen Freiheiten",
      body: "Jeder freie Schnittpunkt direkt neben einem Stein ist eine Freiheit. Verliert ein Stein oder eine Gruppe die letzte Freiheit, wird sie geschlagen und entfernt.",
      note: "Umschließe gegnerische Steine, um sie zu schlagen.",
    },
    {
      title: "Schütze Gruppen mit Platz",
      body: "Verbundene Steine teilen ihre Freiheiten. Eine Gruppe mit zwei getrennten umschlossenen Innenräumen – Augen genannt – kann nicht geschlagen werden.",
      note: "Halte deine Steine anfangs zusammen und gib ihnen Raum.",
    },
    {
      title: "Passe, wenn kein sinnvoller Zug bleibt",
      body: "Du musst keinen Stein setzen. Wähle Passen, wenn ein weiterer Zug nichts verbessert. Passen beide nacheinander, beginnt die Wertung.",
      note: "Passen ist nicht Aufgeben.",
    },
    {
      title: "Prüft die Endposition gemeinsam",
      body: "Gebiet sowie geschlagene oder tote Steine bestimmen die Punkte; Weiß erhält zusätzlich Komi. Markiert tote Gruppen und bestätigt danach beide dieselbe Position.",
      note: "Bei Uneinigkeit spielt ihr weiter. In den Lektionen kannst du alles direkt am Brett üben.",
    },
  ],
  scoring: {
    kicker: "Nach zwei Pässen",
    title: "Prüft jetzt gemeinsam die Endwertung",
    intro: "Die Zahlen sind vorläufig, bis ihr beide derselben Endposition zugestimmt habt.",
    scoreTitle: "Zahlen lesen",
    scoreBody: "Schwarz und Weiß zeigen die aktuellen Punktzahlen. Unter „Wertungsdetails“ siehst du Gebiet, Gefangene und Komi.",
    deadTitle: "Tote Gruppen markieren",
    deadBody: "Tippe in jeder Gruppe, die nicht mehr entkommen kann, einen Stein an. Die ganze verbundene Gruppe wird markiert. Erneutes Tippen macht das rückgängig.",
    confirmTitle: "Wenn alles stimmt",
    confirmBody: "Klicke auf „Endwertung bestätigen“. Die Partie endet erst, wenn beide dieselbe Position bestätigt haben.",
    disputeTitle: "Wenn ihr euch nicht einig seid",
    disputeBody: "Wähle die markierte Gruppe unter „Markierte Gruppe klären“ und spielt weiter. Klärt sie auf dem Brett und passt danach erneut beide.",
    understood: "Verstanden",
    hideNextTime: "Nicht erneut automatisch anzeigen",
    reopen: "Wertung verstehen",
  },
};

const fr: BeginnerGuideCopy = {
  onboarding: {
    kicker: "Démarrage rapide", canPlayTitle: "Savez-vous déjà jouer au go ?", canPlayBody: "Votre réponse nous aide seulement à choisir le bon point de départ.", canPlayYes: "Oui, je sais jouer", canPlayNo: "Non, je débute", rankTitle: "Connaissez-vous approximativement votre rang kyu ?", rankBody: "Si oui, nous pouvons mieux régler votre classement provisoire. Vous pouvez aussi continuer sans l’indiquer.", rankLabel: "Rang kyu approximatif", rankPlaceholder: "Choisir un rang", useRank: "Continuer avec ce rang", skipRank: "Continuer sans rang", tutorialOfferTitle: "Voulez-vous une introduction de deux minutes ?", tutorialOfferBody: "Six étapes courtes expliquent le but, les captures, la passe et le comptage.", startTutorial: "Voir l’introduction", skipTutorial: "Commencer directement", back: "Retour", cancel: "Retour à la création du compte", creating: "Création de votre compte…", tutorialTitle: "Le go en six étapes", stepLabel: "Étape {current} sur {total}", previous: "Précédent", next: "Suivant", finish: "Terminer", openLessons: "Continuer avec les leçons",
  },
  slides: [
    { title: "Entourez plus que votre adversaire", body: "Noir et Blanc posent chacun leur tour une pierre sur une intersection. Le but est d’entourer de l’espace vide pour former votre territoire.", note: "Le joueur qui a le plus de points à la fin gagne." },
    { title: "Posez une pierre par tour", body: "Une pierre posée ne bouge plus. Les pierres de même couleur qui se touchent par un côté forment un groupe connecté.", note: "Les diagonales ne relient pas les pierres." },
    { title: "Les voisins libres sont des libertés", body: "Chaque intersection vide directement voisine d’une pierre est une liberté. Sans liberté, une pierre ou un groupe est capturé et retiré.", note: "Entourez les pierres adverses pour les capturer." },
    { title: "Protégez vos groupes avec de l’espace", body: "Les pierres connectées partagent leurs libertés. Un groupe qui possède deux espaces intérieurs séparés, appelés yeux, ne peut pas être capturé.", note: "Au début, restez connecté et gardez de l’espace." },
    { title: "Passez quand aucun coup n’est utile", body: "Vous n’êtes pas obligé de poser une pierre. Passez lorsqu’un autre coup n’aide plus. Deux passes consécutives lancent le comptage.", note: "Passer n’est pas abandonner." },
    { title: "Vérifiez ensemble la position finale", body: "Le territoire et les pierres capturées ou mortes donnent les points ; Blanc reçoit aussi le komi. Marquez les groupes morts, puis confirmez la même position.", note: "En cas de désaccord, reprenez le jeu. Les leçons permettent de tout pratiquer sur un goban." },
  ],
  scoring: {
    kicker: "Après deux passes", title: "Vérifiez ensemble le score final", intro: "Les nombres restent provisoires jusqu’à ce que vous acceptiez la même position finale.", scoreTitle: "Lire les nombres", scoreBody: "Noir et Blanc indiquent les scores actuels. Ouvrez « Détail du score » pour voir territoire, prisonniers et komi.", deadTitle: "Marquer les groupes morts", deadBody: "Touchez une pierre de chaque groupe qui ne peut plus s’échapper. Tout le groupe est marqué. Touchez-le encore pour l’annuler.", confirmTitle: "Si tout est correct", confirmBody: "Choisissez « Confirmer le score final ». La partie se termine quand les deux joueurs confirment la même position.", disputeTitle: "En cas de désaccord", disputeBody: "Sélectionnez le groupe marqué dans la section de contestation et reprenez le jeu. Réglez la situation, puis passez à nouveau tous les deux.", understood: "Compris", hideNextTime: "Ne plus afficher automatiquement", reopen: "Comprendre le comptage",
  },
};

const es: BeginnerGuideCopy = {
  onboarding: {
    kicker: "Inicio rápido", canPlayTitle: "¿Ya sabes jugar al Go?", canPlayBody: "Tu respuesta solo nos ayuda a elegir el mejor punto de partida.", canPlayYes: "Sí, sé jugar", canPlayNo: "No, soy nuevo", rankTitle: "¿Conoces aproximadamente tu rango kyu?", rankBody: "Si lo conoces, podemos ajustar mejor tu puntuación provisional inicial. También puedes continuar sin indicarlo.", rankLabel: "Rango kyu aproximado", rankPlaceholder: "Elegir un rango", useRank: "Continuar con este rango", skipRank: "Continuar sin rango", tutorialOfferTitle: "¿Quieres una introducción de dos minutos?", tutorialOfferBody: "Seis pasos breves explican el objetivo, las capturas, pasar y la puntuación.", startTutorial: "Ver la introducción", skipTutorial: "Empezar directamente", back: "Atrás", cancel: "Volver al formulario de cuenta", creating: "Creando tu cuenta…", tutorialTitle: "Go en seis pasos", stepLabel: "Paso {current} de {total}", previous: "Anterior", next: "Siguiente", finish: "Terminar", openLessons: "Continuar con las lecciones",
  },
  slides: [
    { title: "Rodea más que tu rival", body: "Negro y Blanco colocan piedras por turnos en las intersecciones. El objetivo es rodear espacio vacío para convertirlo en territorio.", note: "Gana quien tenga más puntos al final." },
    { title: "Coloca una piedra por turno", body: "Una piedra colocada no se mueve. Las piedras del mismo color que se tocan por un lado forman un grupo conectado.", note: "Las diagonales no conectan piedras." },
    { title: "Los puntos vecinos libres son libertades", body: "Cada intersección vacía junto a una piedra es una libertad. Si una piedra o grupo pierde la última, se captura y se retira.", note: "Rodea piedras rivales para capturarlas." },
    { title: "Protege los grupos con espacio", body: "Las piedras conectadas comparten libertades. Un grupo con dos espacios interiores separados, llamados ojos, no puede ser capturado.", note: "Al principio, mantén tus piedras conectadas y con espacio." },
    { title: "Pasa cuando no quede una jugada útil", body: "No tienes que colocar una piedra. Pasa cuando otra jugada no ayude. Tras dos pases consecutivos comienza la puntuación.", note: "Pasar no es rendirse." },
    { title: "Revisad juntos la posición final", body: "El territorio y las piedras capturadas o muertas dan los puntos; Blanco recibe además komi. Marcad los grupos muertos y confirmad la misma posición.", note: "Si no estáis de acuerdo, seguid jugando. Las lecciones permiten practicarlo en el tablero." },
  ],
  scoring: {
    kicker: "Tras dos pases", title: "Revisad juntos la puntuación final", intro: "Los números son provisionales hasta que ambos aceptéis la misma posición final.", scoreTitle: "Leer los números", scoreBody: "Negro y Blanco muestran los puntos actuales. Abre «Detalles de puntuación» para ver territorio, prisioneros y komi.", deadTitle: "Marcar grupos muertos", deadBody: "Toca una piedra de cada grupo que ya no pueda escapar. Se marca todo el grupo conectado. Tócalo otra vez para restaurarlo.", confirmTitle: "Si todo está bien", confirmBody: "Pulsa «Confirmar puntuación final». La partida termina cuando ambos confirman la misma posición.", disputeTitle: "Si no estáis de acuerdo", disputeBody: "Selecciona el grupo marcado en la sección de disputa y continuad jugando. Resolvelo en el tablero y volved a pasar los dos.", understood: "Entendido", hideNextTime: "No volver a mostrar automáticamente", reopen: "Entender la puntuación",
  },
};

const ja: BeginnerGuideCopy = {
  onboarding: {
    kicker: "かんたん設定", canPlayTitle: "囲碁のルールを知っていますか？", canPlayBody: "回答は、あなたに合う始め方を選ぶためだけに使います。", canPlayYes: "はい、打てます", canPlayNo: "いいえ、初めてです", rankTitle: "おおよその級位を知っていますか？", rankBody: "分かれば仮の初期レーティングを調整できます。入力せずに進むこともできます。", rankLabel: "おおよその級位", rankPlaceholder: "級位を選択", useRank: "この級位で進む", skipRank: "級位を入力せず進む", tutorialOfferTitle: "2分の入門を見ますか？", tutorialOfferBody: "目的、石の取り方、パス、得点を6つの短い手順で説明します。", startTutorial: "入門を見る", skipTutorial: "すぐに始める", back: "戻る", cancel: "アカウント作成に戻る", creating: "アカウントを作成中…", tutorialTitle: "6ステップで分かる囲碁", stepLabel: "{total}中{current}ステップ", previous: "前へ", next: "次へ", finish: "完了", openLessons: "レッスンへ進む",
  },
  slides: [
    { title: "相手より多く囲む", body: "黒と白が交互に交点へ石を置きます。空いている場所を囲んで自分の地にするゲームです。", note: "最後に得点が多い方が勝ちです。" },
    { title: "1手に石を1つ置く", body: "置いた石は動きません。縦横で接した同じ色の石は、つながった一つのグループになります。", note: "斜めはつながっていません。" },
    { title: "隣の空点が呼吸点", body: "石の縦横にある空いた交点が呼吸点です。石やグループの最後の呼吸点がなくなると、取られて盤上から外れます。", note: "相手の石を囲むと取れます。" },
    { title: "グループに余裕を持たせる", body: "つながった石は呼吸点を共有します。二つの別々の眼を作れるグループは取られません。", note: "最初は石をつなぎ、広さを保ちましょう。" },
    { title: "有効な手がなければパス", body: "必ず石を置く必要はありません。もう得になる手がなければパスします。二人が続けてパスすると得点確認に進みます。", note: "パスは投了ではありません。" },
    { title: "終局図を二人で確認", body: "地と取った石・死んだ石で得点を数え、白にはコミが加わります。死んだグループを印し、同じ終局図を二人で承認します。", note: "意見が違えば対局を再開します。レッスンでは盤上で練習できます。" },
  ],
  scoring: {
    kicker: "二人がパスした後", title: "最終得点を一緒に確認", intro: "二人が同じ終局図に同意するまでは仮の得点です。", scoreTitle: "数字の見方", scoreBody: "黒と白の現在の得点です。「得点内訳」で地、アゲハマ、コミを確認できます。", deadTitle: "死んだグループを印す", deadBody: "逃げられない各グループの石を一つ押します。つながった全体が印され、もう一度押すと戻ります。", confirmTitle: "正しければ", confirmBody: "「最終得点を確認」を押します。二人が同じ局面を確認すると対局が終了します。", disputeTitle: "意見が違う場合", disputeBody: "印されたグループを選んで対局を再開します。盤上で決着をつけ、再び二人がパスしてください。", understood: "分かりました", hideNextTime: "次回から自動表示しない", reopen: "得点方法を見る",
  },
};

const ko: BeginnerGuideCopy = {
  onboarding: {
    kicker: "빠른 시작", canPlayTitle: "바둑을 둘 줄 아시나요?", canPlayBody: "답변은 알맞은 시작점을 정하는 데만 사용됩니다.", canPlayYes: "네, 둘 줄 알아요", canPlayNo: "아니요, 처음이에요", rankTitle: "대략적인 급수를 알고 있나요?", rankBody: "알고 있다면 임시 시작 레이팅을 더 알맞게 정할 수 있습니다. 입력하지 않고 계속해도 됩니다.", rankLabel: "대략적인 급수", rankPlaceholder: "급수 선택", useRank: "이 급수로 계속", skipRank: "급수 없이 계속", tutorialOfferTitle: "2분 입문을 볼까요?", tutorialOfferBody: "목표, 따내기, 패스, 계가를 여섯 단계로 짧게 설명합니다.", startTutorial: "입문 보기", skipTutorial: "바로 시작", back: "뒤로", cancel: "계정 만들기로 돌아가기", creating: "계정을 만드는 중…", tutorialTitle: "여섯 단계로 배우는 바둑", stepLabel: "{total}단계 중 {current}", previous: "이전", next: "다음", finish: "완료", openLessons: "레슨으로 계속",
  },
  slides: [
    { title: "상대보다 더 많이 둘러싸세요", body: "흑과 백이 번갈아 교차점에 돌을 놓습니다. 빈 공간을 둘러싸 내 집으로 만드는 것이 목표입니다.", note: "마지막에 점수가 더 높은 사람이 이깁니다." },
    { title: "한 수에 돌 하나를 놓으세요", body: "놓은 돌은 움직이지 않습니다. 가로세로로 닿은 같은 색 돌은 하나의 연결된 무리가 됩니다.", note: "대각선은 연결되지 않습니다." },
    { title: "옆의 빈 점이 활로입니다", body: "돌의 가로세로 옆 빈 교차점이 활로입니다. 돌이나 무리의 마지막 활로가 사라지면 잡혀서 판에서 제거됩니다.", note: "상대 돌을 둘러싸 잡으세요." },
    { title: "무리에 공간을 주세요", body: "연결된 돌은 활로를 공유합니다. 서로 떨어진 두 눈을 만들 수 있는 무리는 잡히지 않습니다.", note: "처음에는 돌을 연결하고 여유 공간을 주세요." },
    { title: "둘 곳이 없으면 패스하세요", body: "반드시 돌을 놓을 필요는 없습니다. 더 이득인 수가 없으면 패스합니다. 두 사람이 연속으로 패스하면 계가가 시작됩니다.", note: "패스는 기권이 아닙니다." },
    { title: "마지막 모양을 함께 확인하세요", body: "집과 잡은 돌 또는 죽은 돌로 점수를 내며 백은 덤을 받습니다. 죽은 무리를 표시한 뒤 두 사람이 같은 모양을 확인합니다.", note: "의견이 다르면 다시 둡니다. 레슨에서 판 위로 연습할 수 있습니다." },
  ],
  scoring: {
    kicker: "두 번의 패스 후", title: "최종 점수를 함께 확인하세요", intro: "두 사람이 같은 마지막 모양에 동의할 때까지 숫자는 임시 점수입니다.", scoreTitle: "숫자 읽기", scoreBody: "흑과 백의 현재 점수입니다. ‘점수 내역’을 열어 집, 잡은 돌, 덤을 확인하세요.", deadTitle: "죽은 무리 표시", deadBody: "살아날 수 없는 각 무리의 돌 하나를 누르세요. 연결된 무리 전체가 표시되며 다시 누르면 되돌아옵니다.", confirmTitle: "모두 맞다면", confirmBody: "‘최종 점수 확인’을 누르세요. 두 사람이 같은 모양을 확인해야 대국이 끝납니다.", disputeTitle: "의견이 다르다면", disputeBody: "표시된 무리를 선택하고 대국을 재개하세요. 판 위에서 해결한 뒤 다시 두 사람 모두 패스합니다.", understood: "알겠습니다", hideNextTime: "다시 자동으로 표시하지 않기", reopen: "계가 방법 보기",
  },
};

const zh: BeginnerGuideCopy = {
  onboarding: {
    kicker: "快速开始", canPlayTitle: "你已经会下围棋了吗？", canPlayBody: "你的回答只用于选择合适的入门方式。", canPlayYes: "会，我能下", canPlayNo: "不会，我是新手", rankTitle: "你知道自己大概的级位吗？", rankBody: "如果知道，我们可以更合适地设置临时初始等级分。也可以不填写直接继续。", rankLabel: "大概级位", rankPlaceholder: "选择级位", useRank: "按此级位继续", skipRank: "不填写级位", tutorialOfferTitle: "要看一个两分钟的入门吗？", tutorialOfferBody: "六个简短步骤说明目标、提子、停一手和计分。", startTutorial: "查看入门", skipTutorial: "直接开始", back: "返回", cancel: "返回账户创建", creating: "正在创建账户…", tutorialTitle: "六步学会围棋", stepLabel: "第 {current} 步，共 {total} 步", previous: "上一步", next: "下一步", finish: "完成", openLessons: "继续学习课程",
  },
  slides: [
    { title: "围住比对手更多的地方", body: "黑白双方轮流把棋子放在交叉点上。目标是围住空点，把它们变成自己的地盘。", note: "结束时得分更多的一方获胜。" },
    { title: "每回合下一颗棋", body: "落下的棋子不会移动。横向或纵向相连的同色棋子组成一个棋块。", note: "斜着接触的棋子不相连。" },
    { title: "相邻空点叫作气", body: "棋子上下左右相邻的每个空点都是一口气。棋子或棋块失去最后一口气时会被提走。", note: "围住对方的棋子就能提子。" },
    { title: "给棋块留下空间", body: "相连的棋子共享气。能够形成两个互不相连的眼的棋块无法被提走。", note: "刚开始时尽量保持连接并留出空间。" },
    { title: "没有有用的棋时停一手", body: "你不必每次都落子。继续下不能获益时可选择停一手。双方连续停一手后开始计分。", note: "停一手不等于认输。" },
    { title: "共同确认终局", body: "地盘以及被提或死亡的棋子决定得分，白棋还会获得贴目。标记死棋后，双方确认同一个终局。", note: "如有分歧就继续下。你可以在课程中直接在棋盘上练习。" },
  ],
  scoring: {
    kicker: "双方停一手后", title: "共同检查最终得分", intro: "在双方同意同一个终局前，这些数字只是临时得分。", scoreTitle: "查看数字", scoreBody: "黑白数字是当前得分。打开“得分明细”可查看地盘、提子和贴目。", deadTitle: "标记死棋", deadBody: "在每个无法逃脱的棋块中点一颗棋，整个相连棋块都会被标记。再次点击可以恢复。", confirmTitle: "如果一切正确", confirmBody: "点击“确认最终得分”。只有双方确认同一局面后，对局才会结束。", disputeTitle: "如果意见不同", disputeBody: "在争议区域选择被标记的棋块并继续下棋。在棋盘上解决后，双方再次停一手。", understood: "明白了", hideNextTime: "以后不再自动显示", reopen: "了解计分",
  },
};

const ky: BeginnerGuideCopy = {
  onboarding: {
    kicker: "Тез баштоо", canPlayTitle: "Го оюнун ойной аласызбы?", canPlayBody: "Жообуңуз туура башталышты тандоого гана жардам берет.", canPlayYes: "Ооба, ойной алам", canPlayNo: "Жок, жаңы баштадым", rankTitle: "Болжолдуу кю даражаңызды билесизби?", rankBody: "Билсеңиз, убактылуу баштапкы рейтингиңизди тууралайбыз. Даражасыз да уланта аласыз.", rankLabel: "Болжолдуу кю даражасы", rankPlaceholder: "Даражаны тандаңыз", useRank: "Ушул даража менен улантуу", skipRank: "Даражасыз улантуу", tutorialOfferTitle: "Эки мүнөттүк киришүүнү көрөсүзбү?", tutorialOfferBody: "Алты кыска кадам максатты, таш алууну, пас берүүнү жана эсептөөнү түшүндүрөт.", startTutorial: "Киришүүнү көрүү", skipTutorial: "Дароо баштоо", back: "Артка", cancel: "Аккаунт формасына кайтуу", creating: "Аккаунтуңуз түзүлүүдө…", tutorialTitle: "Го алты кадамда", stepLabel: "{total} кадамдын {current}-кадамы", previous: "Мурунку", next: "Кийинки", finish: "Бүттү", openLessons: "Сабактарга өтүү",
  },
  slides: [
    { title: "Атаандашыңыздан көбүрөөк курчаңыз", body: "Кара жана Ак кезектешип таштарды кесилиштерге коёт. Максат — бош мейкиндикти курчап, өз аймагыңызга айлантуу.", note: "Аягында упайы көп оюнчу жеңет." },
    { title: "Ар жүрүштө бир таш коюңуз", body: "Коюлган таш жылбайт. Кыры менен тийген бир түстөгү таштар бир байланышкан топ түзөт.", note: "Диагональ таштарды бириктирбейт." },
    { title: "Бош кошуна чекиттер — эркиндиктер", body: "Таштын жанындагы ар бир бош кесилиш — эркиндик. Таш же топ акыркы эркиндигин жоготсо, алынып салынат.", note: "Атаандаштын таштарын курчап кармаңыз." },
    { title: "Топторго орун калтырыңыз", body: "Байланышкан таштар эркиндиктерди бөлүшөт. Эки өзүнчө көз түзө алган топту кармоого болбойт.", note: "Башында таштарыңызды байланышта жана кенен кармаңыз." },
    { title: "Пайдалуу жүрүш калбаса пас бериңиз", body: "Ар дайым таш коюу милдеттүү эмес. Кийинки жүрүш жардам бербесе пас бериңиз. Эки оюнчу удаа пас бергенде эсеп башталат.", note: "Пас берүү — багынуу эмес." },
    { title: "Акыркы абалды чогуу текшериңиз", body: "Аймак жана алынган же өлгөн таштар упай берет; Акка коми кошулат. Өлгөн топторду белгилеп, бирдей абалды экөөңүз тең ырастаңыз.", note: "Келишпесеңиз, ойноону улантыңыз. Сабактарда муну тактада машыксаңыз болот." },
  ],
  scoring: {
    kicker: "Эки пастан кийин", title: "Акыркы эсепти чогуу текшериңиз", intro: "Экөөңүз тең бирдей акыркы абалга макул болгонго чейин сандар убактылуу.", scoreTitle: "Сандарды окуу", scoreBody: "Кара менен Актын учурдагы упайлары көрсөтүлөт. Аймакты, туткундарды жана комини эсеп бөлүгүндө көрүңүз.", deadTitle: "Өлгөн топторду белгилөө", deadBody: "Кутула албаган ар бир топтогу бир ташты басыңыз. Бүт байланышкан топ белгиленет; кайра бассаңыз калыбына келет.", confirmTitle: "Баары туура болсо", confirmBody: "Акыркы эсепти ырастоо баскычын басыңыз. Экөөңүз бирдей абалды ырастаганда оюн бүтөт.", disputeTitle: "Макул болбосоңуз", disputeBody: "Белгиленген топту тандап, ойноону улантыңыз. Тактада чечип, анан экөөңүз кайра пас бериңиз.", understood: "Түшүндүм", hideNextTime: "Мындан ары автоматтык көрсөтпөө", reopen: "Эсептөөнү түшүнүү",
  },
};

const COPY: Record<Locale, BeginnerGuideCopy> = { de, en, es, fr, ja, ko, ky, zh };

export function getBeginnerGuideCopy(locale: Locale): BeginnerGuideCopy {
  return COPY[locale];
}
