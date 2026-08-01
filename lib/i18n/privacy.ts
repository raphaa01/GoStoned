import type { Locale, LocalizedText } from "./config";

type LocalizedSection = {
  title: LocalizedText;
  paragraphs?: LocalizedText[];
  items?: LocalizedText[];
};

type LocalizedCookie = {
  name: string;
  purpose: LocalizedText;
  duration: LocalizedText;
};

type LocalizedProcessor = {
  name: string;
  purpose: LocalizedText;
  privacyUrl: string;
};

export type PrivacyCopy = {
  kicker: string;
  title: string;
  subtitle: string;
  navLabel: string;
  metadataDescription: string;
  updatedLabel: string;
  updated: string;
  controller: {
    title: string;
    intro: string;
    representedBy: string;
    address: string;
    contact: string;
  };
  sections: Array<{
    title: string;
    paragraphs: string[];
    items: string[];
  }>;
  cookies: {
    title: string;
    intro: string;
    name: string;
    purpose: string;
    duration: string;
    rows: Array<{ name: string; purpose: string; duration: string }>;
    closing: string;
  };
  processors: {
    title: string;
    intro: string;
    entries: Array<{ name: string; purpose: string; privacyUrl: string }>;
    privacyLabel: string;
    transfer: string;
  };
  rights: {
    title: string;
    intro: string;
    items: string[];
    contact: string;
  };
};

function text(
  en: string,
  de: string,
  fr: string,
  es: string,
  zh: string,
  ja: string,
  ko: string,
): LocalizedText {
  return { en, de, fr, es, zh, ja, ko };
}

const heading = {
  kicker: text(
    "Legal information",
    "Rechtliche Informationen",
    "Informations juridiques",
    "Información jurídica",
    "法律信息",
    "法的情報",
    "법적 정보",
  ),
  title: text(
    "Privacy policy",
    "Datenschutzerklärung",
    "Politique de confidentialité",
    "Política de privacidad",
    "隐私政策",
    "プライバシーポリシー",
    "개인정보 처리방침",
  ),
  subtitle: text(
    "How GoStone processes personal data on its website, web application, APIs, and connected GoStone applications.",
    "Wie GoStone personenbezogene Daten auf der Website, in der Webanwendung, den APIs und verbundenen GoStone-Anwendungen verarbeitet.",
    "Comment GoStone traite les données personnelles sur son site, son application web, ses API et les applications GoStone associées.",
    "Cómo trata GoStone los datos personales en su sitio web, aplicación web, API y aplicaciones GoStone conectadas.",
    "GoStone 如何在网站、Web 应用、API 及关联的 GoStone 应用中处理个人数据。",
    "GoStone がウェブサイト、ウェブアプリ、API、および連携する GoStone アプリで個人データを取り扱う方法を説明します。",
    "GoStone이 웹사이트, 웹 애플리케이션, API 및 연결된 GoStone 애플리케이션에서 개인정보를 처리하는 방법을 설명합니다.",
  ),
  navLabel: text(
    "Privacy",
    "Datenschutz",
    "Confidentialité",
    "Privacidad",
    "隐私",
    "プライバシー",
    "개인정보",
  ),
  metadataDescription: text(
    "Information about personal-data processing, cookies, service providers, retention, and privacy rights at GoStone.",
    "Informationen zur Verarbeitung personenbezogener Daten, zu Cookies, Dienstleistern, Speicherfristen und Datenschutzrechten bei GoStone.",
    "Informations sur le traitement des données personnelles, les cookies, les prestataires, la conservation et vos droits chez GoStone.",
    "Información sobre el tratamiento de datos personales, cookies, proveedores, conservación y derechos de privacidad en GoStone.",
    "关于 GoStone 个人数据处理、Cookie、服务提供商、保存期限和隐私权利的信息。",
    "GoStone における個人データの取扱い、Cookie、委託先、保存期間、およびプライバシー権に関する情報です。",
    "GoStone의 개인정보 처리, 쿠키, 서비스 제공업체, 보관 기간 및 개인정보 권리에 관한 정보입니다.",
  ),
  updatedLabel: text("Last updated", "Stand", "Dernière mise à jour", "Última actualización", "更新日期", "最終更新日", "최종 업데이트"),
  updated: text("August 1, 2026", "1. August 2026", "1 août 2026", "1 de agosto de 2026", "2026年8月1日", "2026年8月1日", "2026년 8월 1일"),
};

const controller = {
  title: text("Controller", "Verantwortlicher", "Responsable du traitement", "Responsable del tratamiento", "数据控制者", "管理者", "개인정보처리자"),
  intro: text(
    "The controller within the meaning of the General Data Protection Regulation (GDPR) is:",
    "Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:",
    "Le responsable du traitement au sens du Règlement général sur la protection des données (RGPD) est :",
    "El responsable del tratamiento en el sentido del Reglamento General de Protección de Datos (RGPD) es:",
    "《通用数据保护条例》（GDPR）意义上的数据控制者是：",
    "一般データ保護規則（GDPR）上の管理者は次のとおりです。",
    "일반개인정보보호법(GDPR)에 따른 개인정보처리자는 다음과 같습니다.",
  ),
  representedBy: text("Represented by", "Vertreten durch", "Représenté par", "Representado por", "代表人", "代表者", "대표자"),
  address: text("Address", "Anschrift", "Adresse", "Dirección", "地址", "住所", "주소"),
  contact: text("Privacy contact", "Datenschutzkontakt", "Contact vie privée", "Contacto de privacidad", "隐私联系邮箱", "プライバシー窓口", "개인정보 문의"),
};

const sections: LocalizedSection[] = [
  {
    title: text("Scope and data sources", "Geltungsbereich und Datenquellen", "Champ d’application et sources", "Ámbito y fuentes de datos", "适用范围和数据来源", "適用範囲とデータの取得元", "적용 범위 및 개인정보 출처"),
    paragraphs: [text(
      "This policy applies to the GoStone website, web application, APIs, and any GoStone application that links to it. We receive data directly from you, automatically from your device and use of the service, and—in games, blocks, or reports—from the other participating player. We do not purchase personal data from data brokers.",
      "Diese Erklärung gilt für die GoStone-Website, die Webanwendung, die APIs und jede GoStone-Anwendung, die auf sie verweist. Daten erhalten wir direkt von dir, automatisch von deinem Gerät und deiner Nutzung sowie – bei Partien, Blockierungen oder Meldungen – vom jeweils anderen Spieler. Wir kaufen keine personenbezogenen Daten von Datenhändlern.",
      "Cette politique s’applique au site GoStone, à l’application web, aux API et à toute application GoStone qui y renvoie. Les données proviennent directement de vous, automatiquement de votre appareil et de votre utilisation, ainsi que de l’autre joueur lors d’une partie, d’un blocage ou d’un signalement. Nous n’achetons pas de données personnelles à des courtiers.",
      "Esta política se aplica al sitio web, la aplicación web, las API y cualquier aplicación GoStone que la enlace. Recibimos datos directamente de ti, automáticamente de tu dispositivo y uso del servicio y, en partidas, bloqueos o denuncias, del otro jugador participante. No compramos datos personales a intermediarios.",
      "本政策适用于 GoStone 网站、Web 应用、API 以及链接到本政策的任何 GoStone 应用。数据可能由您直接提供、由您的设备和服务使用情况自动产生，或在对局、屏蔽和举报中由另一名参与玩家提供。我们不会从数据经纪商购买个人数据。",
      "本ポリシーは、GoStone のウェブサイト、ウェブアプリ、API、および本ポリシーにリンクする GoStone アプリに適用されます。データは、利用者本人、端末およびサービス利用から自動的に取得するほか、対局、ブロック、通報では相手プレイヤーから取得することがあります。データブローカーから個人データを購入することはありません。",
      "본 방침은 GoStone 웹사이트, 웹 애플리케이션, API 및 본 방침에 연결된 GoStone 애플리케이션에 적용됩니다. 개인정보는 이용자로부터 직접, 기기 및 서비스 이용 과정에서 자동으로, 그리고 대국·차단·신고의 경우 상대 플레이어로부터 수집될 수 있습니다. 데이터 브로커로부터 개인정보를 구매하지 않습니다.",
    )],
  },
  {
    title: text("Processing when the service is accessed", "Verarbeitung beim Aufruf des Dienstes", "Traitement lors de l’accès au service", "Tratamiento al acceder al servicio", "访问服务时的数据处理", "サービスへのアクセス時の処理", "서비스 접속 시 처리"),
    paragraphs: [text(
      "When you access GoStone, the hosting infrastructure processes technical request data needed to deliver and secure the service. This can include the IP address, date and time, requested address and search parameters, request method, response status, referrer, user agent, language header, request identifier, and processing region. The purpose is reliable delivery, troubleshooting, and protection against attacks and misuse. The legal basis is Article 6(1)(f) GDPR; our legitimate interests are the secure and reliable operation of GoStone. Vercel runtime logs are retained according to the booked plan for no more than 30 days.",
      "Beim Aufruf von GoStone verarbeitet die Hosting-Infrastruktur technische Anfragedaten, die zur Auslieferung und Absicherung des Dienstes erforderlich sind. Dazu können IP-Adresse, Datum und Uhrzeit, aufgerufene Adresse und Suchparameter, Anfragemethode, Antwortstatus, Referrer, User-Agent, Sprachheader, Anfragekennung und Verarbeitungsregion gehören. Zwecke sind die zuverlässige Bereitstellung, Fehleranalyse sowie der Schutz vor Angriffen und Missbrauch. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; unsere berechtigten Interessen sind der sichere und zuverlässige Betrieb von GoStone. Vercel-Laufzeitprotokolle werden abhängig vom gebuchten Tarif höchstens 30 Tage gespeichert.",
      "Lors de l’accès à GoStone, l’infrastructure d’hébergement traite les données techniques nécessaires à la fourniture et à la sécurité du service : adresse IP, date et heure, adresse et paramètres demandés, méthode, état de la réponse, référent, agent utilisateur, langue, identifiant de requête et région de traitement. Les finalités sont la fourniture fiable, le diagnostic et la protection contre les attaques et abus. La base juridique est l’article 6, paragraphe 1, point f) du RGPD ; notre intérêt légitime est l’exploitation sûre et fiable de GoStone. Les journaux d’exécution Vercel sont conservés, selon l’offre souscrite, au maximum 30 jours.",
      "Al acceder a GoStone, la infraestructura de alojamiento trata datos técnicos necesarios para prestar y proteger el servicio. Pueden incluir dirección IP, fecha y hora, dirección y parámetros solicitados, método, estado de respuesta, referente, agente de usuario, idioma, identificador de solicitud y región de procesamiento. Se usan para una prestación fiable, diagnóstico y protección frente a ataques y abusos. La base jurídica es el artículo 6.1.f del RGPD; nuestro interés legítimo es operar GoStone de forma segura y fiable. Los registros de ejecución de Vercel se conservan, según el plan contratado, durante un máximo de 30 días.",
      "访问 GoStone 时，托管基础设施会处理提供和保护服务所需的技术请求数据，包括 IP 地址、日期和时间、请求地址及查询参数、请求方法、响应状态、来源页面、用户代理、语言标头、请求标识符和处理区域。处理目的为可靠提供服务、排查故障以及防范攻击和滥用。法律依据为 GDPR 第6条第1款(f)项；我们的合法利益是安全可靠地运营 GoStone。Vercel 运行日志依所购方案保存，最长不超过30天。",
      "GoStone へのアクセス時、ホスティング基盤はサービスの提供と保護に必要な技術的リクエストデータを処理します。これには IP アドレス、日時、アクセス先と検索パラメータ、メソッド、応答ステータス、リファラー、ユーザーエージェント、言語ヘッダー、リクエスト ID、処理リージョンが含まれる場合があります。目的は安定提供、障害調査、攻撃・不正利用の防止です。法的根拠は GDPR 第6条1項(f)であり、安全で安定した運営が正当な利益です。Vercel のランタイムログは契約プランに応じ、最長30日保存されます。",
      "GoStone 접속 시 호스팅 인프라는 서비스 제공과 보호에 필요한 기술적 요청 데이터를 처리합니다. 여기에는 IP 주소, 날짜와 시간, 요청 주소 및 검색 매개변수, 요청 방식, 응답 상태, 리퍼러, 사용자 에이전트, 언어 헤더, 요청 식별자와 처리 지역이 포함될 수 있습니다. 목적은 안정적인 제공, 오류 분석, 공격 및 오용 방지입니다. 법적 근거는 GDPR 제6조 제1항 (f)이며, 안전하고 안정적인 운영이 정당한 이익입니다. Vercel 런타임 로그는 이용 요금제에 따라 최대 30일 보관됩니다.",
    )],
  },
  {
    title: text("Accounts and authentication", "Konten und Authentifizierung", "Comptes et authentification", "Cuentas y autenticación", "账户与身份验证", "アカウントと認証", "계정 및 인증"),
    paragraphs: [
      text(
        "You can create an account with a username and password. We store a generated user ID, username, display name, password hash, creation and update times, and hashed session tokens. We never store the password in plain text, and an email address is not required for this method. The data is used to create and authenticate the account and to retain the profile, ratings, and game history. The legal basis is Article 6(1)(b) GDPR. Guest play remains available.",
        "Du kannst ein Konto mit Benutzername und Passwort erstellen. Gespeichert werden eine erzeugte Nutzer-ID, Benutzername, Anzeigename, Passwort-Hash, Erstellungs- und Änderungszeitpunkte sowie gehashte Sitzungstokens. Das Passwort wird niemals im Klartext gespeichert; eine E-Mail-Adresse ist für diese Methode nicht erforderlich. Die Daten dienen der Kontoerstellung und Anmeldung sowie der Speicherung von Profil, Wertungen und Partieverlauf. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Das Spielen als Gast bleibt möglich.",
        "Vous pouvez créer un compte avec un nom d’utilisateur et un mot de passe. Nous conservons un identifiant généré, le nom affiché, une empreinte du mot de passe, les dates de création et de mise à jour et des jetons de session hachés. Le mot de passe n’est jamais stocké en clair et cette méthode n’exige pas d’adresse e-mail. Ces données servent à créer et authentifier le compte et à conserver le profil, les classements et l’historique. La base juridique est l’article 6, paragraphe 1, point b) du RGPD. Le jeu en invité reste possible.",
        "Puedes crear una cuenta con nombre de usuario y contraseña. Guardamos un identificador generado, nombre visible, hash de contraseña, fechas de creación y actualización y tokens de sesión con hash. Nunca guardamos la contraseña en texto claro y este método no exige correo electrónico. Los datos se usan para crear y autenticar la cuenta y conservar el perfil, las puntuaciones y el historial. La base jurídica es el artículo 6.1.b del RGPD. Puedes seguir jugando como invitado.",
        "您可以使用用户名和密码创建账户。我们会保存生成的用户 ID、用户名、显示名称、密码哈希、创建与更新时间以及经过哈希处理的会话令牌。密码绝不会以明文保存，此方式也不要求电子邮箱。上述数据用于创建和验证账户并保存个人资料、等级分和对局历史。法律依据为 GDPR 第6条第1款(b)项。您仍可作为访客游戏。",
        "ユーザー名とパスワードでアカウントを作成できます。生成されたユーザー ID、ユーザー名、表示名、パスワードのハッシュ、作成・更新日時、ハッシュ化されたセッショントークンを保存します。パスワードを平文で保存することはなく、この方法ではメールアドレスは必須ではありません。アカウントの作成・認証、プロフィール、レーティング、対局履歴の保持に利用します。法的根拠は GDPR 第6条1項(b)です。ゲストとしても利用できます。",
        "사용자 이름과 비밀번호로 계정을 만들 수 있습니다. 생성된 사용자 ID, 사용자 이름, 표시 이름, 비밀번호 해시, 생성·수정 시각 및 해시된 세션 토큰을 저장합니다. 비밀번호는 평문으로 저장하지 않으며 이 방식에는 이메일 주소가 필요하지 않습니다. 계정 생성과 인증, 프로필, 레이팅 및 대국 기록 보존에 사용합니다. 법적 근거는 GDPR 제6조 제1항 (b)입니다. 게스트 플레이도 가능합니다.",
      ),
      text(
        "Alternatively, you can choose Google or Apple sign-in. You are redirected to that provider, which processes the authentication request under its own privacy terms. GoStone receives the provider-specific account identifier, verified email address, and—when supplied—your name. We store the identifier mapping, email and verification status to recognize the account; we do not store provider access or refresh tokens. The legal basis is Article 6(1)(b) GDPR because this processing performs the sign-in method you request.",
        "Alternativ kannst du die Anmeldung mit Google oder Apple wählen. Du wirst zum jeweiligen Anbieter weitergeleitet, der die Authentifizierungsanfrage nach seinen eigenen Datenschutzbedingungen verarbeitet. GoStone erhält die anbieterspezifische Kontokennung, die bestätigte E-Mail-Adresse und – sofern übermittelt – deinen Namen. Wir speichern die Zuordnung, E-Mail-Adresse und den Bestätigungsstatus zur Wiedererkennung des Kontos; Zugriffs- oder Aktualisierungstokens des Anbieters werden nicht gespeichert. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, da die von dir gewählte Anmeldemethode ausgeführt wird.",
        "Vous pouvez aussi choisir la connexion Google ou Apple. Vous êtes redirigé vers ce fournisseur, qui traite la demande selon ses propres règles de confidentialité. GoStone reçoit l’identifiant propre au fournisseur, l’adresse e-mail vérifiée et, s’il est transmis, votre nom. Nous conservons cette association, l’e-mail et son état de vérification pour reconnaître le compte ; aucun jeton d’accès ou d’actualisation du fournisseur n’est conservé. La base juridique est l’article 6, paragraphe 1, point b) du RGPD.",
        "También puedes iniciar sesión con Google o Apple. Serás redirigido al proveedor, que trata la autenticación según sus propias condiciones de privacidad. GoStone recibe el identificador del proveedor, el correo verificado y, si se facilita, tu nombre. Guardamos la asociación, el correo y su estado de verificación para reconocer la cuenta; no guardamos tokens de acceso ni de actualización. La base jurídica es el artículo 6.1.b del RGPD.",
        "您也可以选择使用 Google 或 Apple 登录。系统会将您重定向至相应提供商，提供商将依据其自身隐私条款处理验证请求。GoStone 会收到提供商专用账户标识符、已验证的电子邮箱以及（如提供）您的姓名。我们保存标识符映射、邮箱及验证状态以识别账户；不会保存提供商访问令牌或刷新令牌。法律依据为 GDPR 第6条第1款(b)项。",
        "Google または Apple でのサインインも選択できます。各事業者に移動し、そのプライバシー条件に基づいて認証が処理されます。GoStone は事業者固有のアカウント ID、確認済みメールアドレス、提供された場合は氏名を受け取ります。アカウント識別のため対応関係、メール、確認状態を保存しますが、アクセストークンや更新トークンは保存しません。法的根拠は GDPR 第6条1項(b)です。",
        "Google 또는 Apple 로그인을 선택할 수도 있습니다. 해당 업체로 이동하며 업체는 자체 개인정보 조건에 따라 인증 요청을 처리합니다. GoStone은 업체별 계정 식별자, 확인된 이메일 주소 및 제공된 경우 이름을 받습니다. 계정 식별을 위해 연결 정보, 이메일 및 확인 상태를 저장하지만 업체의 액세스 토큰이나 갱신 토큰은 저장하지 않습니다. 법적 근거는 GDPR 제6조 제1항 (b)입니다.",
      ),
    ],
  },
  {
    title: text("Playing and platform features", "Spielen und Plattformfunktionen", "Jeu et fonctionnalités", "Juego y funciones de la plataforma", "对局与平台功能", "対局とプラットフォーム機能", "대국 및 플랫폼 기능"),
    items: [
      text(
        "Guest play and matchmaking: a random guest ID, hashed guest-session token, selected board size, time control, queue status, timestamps, and game assignment are processed to provide the requested match. Legal basis: Article 6(1)(b) GDPR.",
        "Gastspiel und Gegnersuche: Eine zufällige Gast-ID, der gehashte Gast-Sitzungstoken, gewählte Brettgröße, Bedenkzeit, Warteschlangenstatus, Zeitpunkte und Partiezuordnung werden verarbeitet, um die gewünschte Partie bereitzustellen. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.",
        "Jeu invité et appariement : un identifiant invité aléatoire, un jeton de session haché, la taille du plateau, la cadence, l’état de la file, les horodatages et l’affectation à une partie sont traités pour fournir la partie demandée. Base juridique : article 6, paragraphe 1, point b) du RGPD.",
        "Juego como invitado y emparejamiento: se tratan un ID aleatorio de invitado, token de sesión con hash, tamaño de tablero, control de tiempo, estado de cola, marcas de tiempo y asignación de partida para prestar la partida solicitada. Base jurídica: artículo 6.1.b del RGPD.",
        "访客游戏和匹配：为提供所请求的对局，我们会处理随机访客 ID、经哈希处理的访客会话令牌、所选棋盘大小、用时设置、队列状态、时间戳和对局分配。法律依据：GDPR 第6条第1款(b)项。",
        "ゲスト対局とマッチング：希望する対局を提供するため、ランダムなゲスト ID、ハッシュ化されたゲストセッショントークン、盤サイズ、持ち時間、待機状態、時刻、対局割当を処理します。法的根拠：GDPR 第6条1項(b)。",
        "게스트 플레이 및 매칭: 요청한 대국을 제공하기 위해 무작위 게스트 ID, 해시된 게스트 세션 토큰, 선택한 바둑판 크기, 시간 설정, 대기열 상태, 시각 및 대국 배정을 처리합니다. 법적 근거: GDPR 제6조 제1항 (b).",
      ),
      text(
        "Games: participant identifiers, moves, board positions and hashes, clocks, scoring decisions, result, timestamps, and rule settings are stored to run, resume, validate, score, and review games. Account games also update ratings and rating history. Legal basis: Article 6(1)(b) GDPR.",
        "Partien: Teilnehmerkennungen, Züge, Brettstellungen und -Hashes, Uhren, Wertungsentscheidungen, Ergebnis, Zeitpunkte und Regeleinstellungen werden gespeichert, um Partien durchzuführen, fortzusetzen, zu prüfen, zu werten und auszuwerten. Kontopartien aktualisieren außerdem Wertung und Wertungsverlauf. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.",
        "Parties : les identifiants des participants, coups, positions et empreintes du plateau, pendules, décisions de décompte, résultat, horodatages et règles sont conservés pour exécuter, reprendre, valider, compter et revoir les parties. Les parties de comptes mettent aussi à jour les classements. Base juridique : article 6, paragraphe 1, point b) du RGPD.",
        "Partidas: se guardan identificadores de participantes, movimientos, posiciones y hashes del tablero, relojes, decisiones de puntuación, resultado, marcas de tiempo y reglas para ejecutar, reanudar, validar, puntuar y revisar partidas. Las partidas de cuentas también actualizan puntuaciones e historial. Base jurídica: artículo 6.1.b del RGPD.",
        "对局：我们保存参与者标识符、落子、棋盘状态及哈希、棋钟、计分决定、结果、时间戳和规则设置，以运行、恢复、验证、计分和复盘对局。账户对局还会更新等级分及其历史。法律依据：GDPR 第6条第1款(b)项。",
        "対局：対局の実行、再開、検証、採点、検討のため、参加者 ID、着手、盤面とハッシュ、時計、採点判断、結果、時刻、ルール設定を保存します。アカウント対局ではレーティングと履歴も更新されます。法的根拠：GDPR 第6条1項(b)。",
        "대국: 대국 진행, 재개, 검증, 계가 및 복기를 위해 참가자 식별자, 수순, 바둑판 상태와 해시, 시계, 계가 결정, 결과, 시각 및 규칙 설정을 저장합니다. 계정 대국은 레이팅과 레이팅 기록도 갱신합니다. 법적 근거: GDPR 제6조 제1항 (b).",
      ),
      text(
        "Chat: the participant identifier, display name, message of up to 500 characters, game assignment, and timestamp are processed to provide game chat. Messages are visible only to the two participants while chat is available. A local rules-based filter checks messages before storage; rejected messages are not stored. Legal basis: Article 6(1)(b) GDPR.",
        "Chat: Teilnehmerkennung, Anzeigename, Nachricht mit höchstens 500 Zeichen, Partiezuordnung und Zeitpunkt werden für den Partiechat verarbeitet. Nachrichten sind nur für die beiden Teilnehmer sichtbar, solange der Chat verfügbar ist. Ein lokaler regelbasierter Filter prüft Nachrichten vor der Speicherung; abgelehnte Nachrichten werden nicht gespeichert. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.",
        "Chat : l’identifiant du participant, le nom affiché, le message limité à 500 caractères, la partie et l’horodatage sont traités pour fournir le chat. Les messages ne sont visibles que des deux participants lorsque le chat est disponible. Un filtre local fondé sur des règles vérifie les messages avant stockage ; les messages refusés ne sont pas conservés. Base juridique : article 6, paragraphe 1, point b) du RGPD.",
        "Chat: se tratan identificador del participante, nombre visible, mensaje de hasta 500 caracteres, partida y marca de tiempo para prestar el chat. Los mensajes solo son visibles para ambos participantes mientras el chat está disponible. Un filtro local basado en reglas los comprueba antes de guardarlos; los rechazados no se almacenan. Base jurídica: artículo 6.1.b del RGPD.",
        "聊天：为提供对局聊天，我们处理参与者标识符、显示名称、不超过500个字符的消息、所属对局和时间戳。聊天可用时，消息仅对两名参与者可见。消息保存前会由本地规则过滤器检查；被拒绝的消息不会保存。法律依据：GDPR 第6条第1款(b)项。",
        "チャット：対局チャットの提供のため、参加者 ID、表示名、500文字以内のメッセージ、対局情報、時刻を処理します。利用可能な間、メッセージは対局者2名だけに表示されます。保存前にローカルのルールベースフィルターで確認し、拒否されたメッセージは保存しません。法的根拠：GDPR 第6条1項(b)。",
        "채팅: 대국 채팅 제공을 위해 참가자 식별자, 표시 이름, 최대 500자의 메시지, 대국 정보 및 시각을 처리합니다. 채팅이 제공되는 동안 두 참가자에게만 표시됩니다. 저장 전 로컬 규칙 기반 필터로 확인하며 거부된 메시지는 저장하지 않습니다. 법적 근거: GDPR 제6조 제1항 (b).",
      ),
      text(
        "Puzzles, bots, and analysis: puzzle selections, attempts, progress, solution status, and timestamps are stored. Bot moves and end-score proposals are calculated locally on your device; only the proposed action is sent to GoStone for rule validation and storage. If you request a KataGo review, the game identifier, rules, moves, and generated analysis are processed by our separate KataGo worker. Legal basis: Article 6(1)(b) GDPR.",
        "Puzzles, Bots und Analyse: Puzzleauswahl, Versuche, Fortschritt, Lösungsstatus und Zeitpunkte werden gespeichert. Bot-Züge und Endstandsvorschläge werden lokal auf deinem Gerät berechnet; nur die vorgeschlagene Aktion wird zur Regelprüfung und Speicherung an GoStone gesendet. Wenn du eine KataGo-Analyse anforderst, verarbeitet unser separater KataGo-Worker Partiekennung, Regeln, Züge und die erzeugte Analyse. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.",
        "Problèmes, robots et analyse : les sélections, tentatives, progrès, état de résolution et horodatages sont conservés. Les coups du robot et les propositions de score final sont calculés localement sur votre appareil ; seule l’action proposée est envoyée à GoStone pour validation et stockage. Une analyse KataGo traite séparément l’identifiant, les règles, les coups et l’analyse générée. Base juridique : article 6, paragraphe 1, point b) du RGPD.",
        "Problemas, bots y análisis: se guardan selección, intentos, progreso, estado de resolución y marcas de tiempo. Los movimientos del bot y las propuestas de puntuación final se calculan localmente en tu dispositivo; solo la acción propuesta se envía a GoStone para validarla y guardarla. Una revisión KataGo procesa por separado el identificador, las reglas, los movimientos y el análisis generado. Base jurídica: artículo 6.1.b del RGPD.",
        "题目、机器人和分析：我们保存题目选择、尝试次数、进度、解题状态和时间戳。机器人落子和终局计分建议在您的设备本地计算；只有建议操作会发送给 GoStone 进行规则验证和保存。请求 KataGo 复盘时，独立工作进程会处理对局标识符、规则、落子和生成的分析。法律依据：GDPR 第6条第1款(b)项。",
        "問題、ボット、解析：問題の選択、試行、進行状況、正解状態、時刻を保存します。ボット着手と終局スコア案は端末上で計算され、提案された操作だけがルール確認と保存のため GoStone に送信されます。KataGo 解析を依頼した場合は、別のワーカーが対局 ID、ルール、着手、生成された解析を処理します。法的根拠：GDPR 第6条1項(b)。",
        "문제, 봇 및 분석: 문제 선택, 시도, 진행 상황, 해결 여부 및 시각을 저장합니다. 봇 착점과 최종 점수 제안은 기기에서 로컬로 계산되며 제안된 동작만 규칙 검증과 저장을 위해 GoStone으로 전송됩니다. KataGo 분석을 요청하면 별도 워커가 대국 식별자, 규칙, 수순 및 생성된 분석을 처리합니다. 법적 근거: GDPR 제6조 제1항 (b).",
      ),
    ],
  },
  {
    title: text("Public information and other players", "Öffentliche Angaben und andere Spieler", "Informations publiques et autres joueurs", "Información pública y otros jugadores", "公开信息与其他玩家", "公開情報と他のプレイヤー", "공개 정보 및 다른 플레이어"),
    items: [
      text(
        "Your username or display name is shown to opponents. Public leaderboards show account display names, position, rating, game count, and wins. Do not choose a username that reveals information you do not want to make public.",
        "Dein Benutzer- beziehungsweise Anzeigename wird Gegnern angezeigt. Öffentliche Ranglisten zeigen Anzeigename, Rang, Wertung, Partienanzahl und Siege von Konten. Wähle keinen Benutzernamen, der Angaben offenlegt, die du nicht veröffentlichen möchtest.",
        "Votre nom d’utilisateur ou d’affichage est présenté aux adversaires. Les classements publics affichent le nom, la position, le classement, le nombre de parties et les victoires des comptes. Ne choisissez pas un nom révélant des informations que vous ne souhaitez pas rendre publiques.",
        "Tu nombre de usuario o visible se muestra a los oponentes. Las clasificaciones públicas muestran nombre, posición, puntuación, partidas y victorias de las cuentas. No elijas un nombre que revele información que no quieras hacer pública.",
        "您的用户名或显示名称会向对手显示。公开排行榜会显示账户的显示名称、名次、等级分、对局数和胜局数。请勿选择会泄露您不希望公开的信息的用户名。",
        "ユーザー名または表示名は対戦相手に表示されます。公開ランキングには、アカウントの表示名、順位、レーティング、対局数、勝数が表示されます。公開したくない情報を含むユーザー名は選ばないでください。",
        "사용자 이름 또는 표시 이름은 상대에게 표시됩니다. 공개 순위표에는 계정의 표시 이름, 순위, 레이팅, 대국 수 및 승수가 표시됩니다. 공개하고 싶지 않은 정보가 드러나는 이름을 선택하지 마세요.",
      ),
      text(
        "Game state and chat are disclosed only to the participating players through protected game routes. Aggregate activity counts are public and do not identify individual players.",
        "Partiestand und Chat werden über geschützte Partierouten nur den teilnehmenden Spielern bereitgestellt. Öffentliche Aktivitätszahlen sind zusammengefasst und identifizieren keine einzelnen Spieler.",
        "L’état de la partie et le chat ne sont communiqués qu’aux joueurs participants par des routes protégées. Les chiffres publics d’activité sont agrégés et n’identifient personne.",
        "El estado de la partida y el chat solo se comunican a los participantes mediante rutas protegidas. Los recuentos públicos de actividad son agregados y no identifican jugadores.",
        "对局状态和聊天内容仅通过受保护的对局接口向参与玩家提供。公开的活动数量为汇总数据，不会识别单个玩家。",
        "対局状態とチャットは、保護された対局経路を通じて参加プレイヤーだけに提供されます。公開される利用状況は集計値で、個人を特定しません。",
        "대국 상태와 채팅은 보호된 대국 경로를 통해 참가 플레이어에게만 제공됩니다. 공개 활동 수치는 집계값이며 개별 플레이어를 식별하지 않습니다.",
      ),
      text(
        "We do not sell personal data and do not disclose it for advertising. Further disclosure occurs only to the processors named below, when legally required, or when necessary to establish, exercise, or defend legal claims.",
        "Wir verkaufen keine personenbezogenen Daten und geben sie nicht für Werbung weiter. Eine weitere Offenlegung erfolgt nur an die unten genannten Auftragsverarbeiter, bei gesetzlicher Verpflichtung oder soweit dies zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen erforderlich ist.",
        "Nous ne vendons aucune donnée personnelle et ne la communiquons pas à des fins publicitaires. Toute autre communication est limitée aux sous-traitants ci-dessous, aux obligations légales ou à la constatation, l’exercice ou la défense de droits en justice.",
        "No vendemos datos personales ni los comunicamos con fines publicitarios. Solo se comunican además a los encargados indicados, cuando lo exige la ley o para formular, ejercer o defender reclamaciones legales.",
        "我们不会出售个人数据，也不会将其用于广告披露。其他披露仅限于下列处理者、法律要求的情况，或为提出、行使或抗辩法律主张所必需的情况。",
        "個人データを販売したり、広告目的で開示したりすることはありません。以下の委託先、法令上必要な場合、または法的請求の確立・行使・防御に必要な場合に限り、開示します。",
        "개인정보를 판매하거나 광고 목적으로 제공하지 않습니다. 아래 수탁업체, 법적 의무가 있는 경우 또는 법적 청구의 제기·행사·방어에 필요한 경우에만 추가로 제공합니다.",
      ),
    ],
  },
  {
    title: text("Safety, rate limits, blocks, and reports", "Sicherheit, Begrenzungen, Blockierungen und Meldungen", "Sécurité, limitations, blocages et signalements", "Seguridad, límites, bloqueos y denuncias", "安全、频率限制、屏蔽和举报", "安全対策、レート制限、ブロック、通報", "보안, 요청 제한, 차단 및 신고"),
    paragraphs: [text(
      "To prevent automated attacks, account takeover, spam, and misuse, GoStone creates one-way SHA-256 rate-limit keys from the IP address and, depending on the action, a username or verified player identifier. The raw IP address, cookie, and player identifier are not stored in the rate-limit table. Blocking stores the two player identifiers and blocks future matching and chat. If the reporting function is enabled and a report is submitted, the game, reporter, reported player, fixed report category, and time are stored; no free-text report or copied chat transcript is collected. These processes are based on Article 6(1)(f) GDPR. Our legitimate interests are service security, fair play, protecting users, and enforcing platform rules.",
      "Zum Schutz vor automatisierten Angriffen, Kontoübernahmen, Spam und Missbrauch bildet GoStone nicht umkehrbare SHA-256-Schlüssel aus der IP-Adresse und – abhängig von der Aktion – einem Benutzernamen oder der verifizierten Spielerkennung. IP-Adresse, Cookie und Spielerkennung werden in der Rate-Limit-Tabelle nicht im Klartext gespeichert. Eine Blockierung speichert die beiden Spielerkennungen und verhindert künftige Zuordnungen und Chats. Wenn die Meldefunktion aktiviert ist und eine Meldung abgegeben wird, werden Partie, meldender und gemeldeter Spieler, eine feste Meldekategorie und der Zeitpunkt gespeichert; Freitext oder eine kopierte Chatabschrift werden nicht erhoben. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unsere berechtigten Interessen sind Dienstsicherheit, Fair Play, Nutzerschutz und die Durchsetzung der Plattformregeln.",
      "Pour prévenir les attaques automatisées, prises de compte, spams et abus, GoStone crée des clés SHA-256 non réversibles à partir de l’adresse IP et, selon l’action, d’un nom d’utilisateur ou identifiant de joueur vérifié. L’adresse IP, le cookie et l’identifiant ne sont pas stockés en clair dans la table de limitation. Un blocage conserve les deux identifiants et empêche les futurs appariements et chats. Si le signalement est activé et utilisé, la partie, l’auteur, le joueur signalé, une catégorie fixe et l’heure sont conservés ; aucun texte libre ni copie du chat n’est collecté. Base juridique : article 6, paragraphe 1, point f) du RGPD. Nos intérêts légitimes sont la sécurité, le fair-play, la protection des utilisateurs et l’application des règles.",
      "Para prevenir ataques automatizados, apropiación de cuentas, spam y abusos, GoStone crea claves SHA-256 no reversibles a partir de la dirección IP y, según la acción, un nombre de usuario o identificador verificado. La IP, cookie e identificador no se guardan en claro en la tabla de límites. Bloquear guarda ambos identificadores e impide futuros emparejamientos y chat. Si se habilita la denuncia y se envía una, se guardan partida, denunciante, jugador denunciado, categoría fija y momento; no se recogen texto libre ni copias del chat. Base jurídica: artículo 6.1.f del RGPD. Nuestros intereses legítimos son seguridad, juego limpio, protección de usuarios y cumplimiento de las reglas.",
      "为防止自动攻击、账户接管、垃圾信息和滥用，GoStone 会根据 IP 地址以及视操作而定的用户名或已验证玩家标识符生成不可逆的 SHA-256 频率限制键。频率限制表不会以明文保存 IP 地址、Cookie 或玩家标识符。屏蔽功能会保存双方玩家标识符，并阻止今后的匹配和聊天。如果举报功能已启用且您提交举报，我们会保存对局、举报人、被举报玩家、固定举报类别和时间；不会收集自由文本或复制聊天记录。法律依据为 GDPR 第6条第1款(f)项。我们的合法利益是服务安全、公平竞技、保护用户和执行平台规则。",
      "自動攻撃、アカウント乗っ取り、スパム、不正利用を防ぐため、GoStone は IP アドレスと、操作に応じてユーザー名または確認済みプレイヤー ID から不可逆な SHA-256 レート制限キーを生成します。レート制限テーブルに IP アドレス、Cookie、プレイヤー ID を平文で保存しません。ブロックでは双方の ID を保存し、今後のマッチングとチャットを防ぎます。通報機能が有効で通報された場合、対局、通報者、対象者、固定カテゴリ、時刻を保存し、自由記述やチャット全文の複製は収集しません。法的根拠は GDPR 第6条1項(f)です。正当な利益は、サービスの安全、公正な対局、利用者保護、ルールの執行です。",
      "자동 공격, 계정 탈취, 스팸 및 오용을 막기 위해 GoStone은 IP 주소와 작업에 따라 사용자 이름 또는 확인된 플레이어 식별자로부터 되돌릴 수 없는 SHA-256 요청 제한 키를 생성합니다. 요청 제한 테이블에는 IP 주소, 쿠키 및 플레이어 식별자를 평문으로 저장하지 않습니다. 차단은 두 플레이어 식별자를 저장하고 이후 매칭과 채팅을 막습니다. 신고 기능이 활성화되어 신고가 제출되면 대국, 신고자, 신고 대상, 정해진 신고 범주와 시각을 저장하며 자유 서술이나 채팅 사본은 수집하지 않습니다. 법적 근거는 GDPR 제6조 제1항 (f)이며 정당한 이익은 서비스 보안, 공정한 대국, 사용자 보호 및 규칙 집행입니다.",
    )],
  },
  {
    title: text("Contact requests", "Kontaktanfragen", "Demandes de contact", "Solicitudes de contacto", "联系请求", "お問い合わせ", "문의"),
    paragraphs: [text(
      "If you contact us, we process your contact details, message, and related communication metadata to answer and manage the request. The legal basis is Article 6(1)(b) GDPR for service- or contract-related requests, Article 6(1)(c) GDPR where a legal duty applies, and otherwise Article 6(1)(f) GDPR based on our legitimate interest in responding to inquiries and documenting relevant communications.",
      "Wenn du uns kontaktierst, verarbeiten wir deine Kontaktdaten, Nachricht und zugehörige Kommunikationsmetadaten, um die Anfrage zu beantworten und zu bearbeiten. Rechtsgrundlage ist bei dienst- oder vertragsbezogenen Anliegen Art. 6 Abs. 1 lit. b DSGVO, bei einer rechtlichen Verpflichtung Art. 6 Abs. 1 lit. c DSGVO und ansonsten Art. 6 Abs. 1 lit. f DSGVO aufgrund unseres berechtigten Interesses, Anfragen zu beantworten und relevante Kommunikation nachweisen zu können.",
      "Si vous nous contactez, nous traitons vos coordonnées, votre message et les métadonnées associées pour répondre et gérer la demande. La base juridique est l’article 6, paragraphe 1, point b) du RGPD pour les demandes liées au service ou au contrat, le point c) en cas d’obligation légale et, sinon, le point f), au titre de notre intérêt légitime à répondre et documenter les échanges pertinents.",
      "Si nos contactas, tratamos tus datos de contacto, mensaje y metadatos relacionados para responder y gestionar la solicitud. La base jurídica es el artículo 6.1.b del RGPD para asuntos del servicio o contrato, el artículo 6.1.c cuando exista obligación legal y, en los demás casos, el artículo 6.1.f por nuestro interés legítimo en responder y documentar comunicaciones relevantes.",
      "如果您联系我们，我们会处理您的联系方式、消息和相关通信元数据，以回复和处理请求。与服务或合同有关的请求依据 GDPR 第6条第1款(b)项处理；存在法律义务时依据(c)项处理；其他情况下依据(f)项以及我们回复咨询并记录相关通信的合法利益处理。",
      "お問い合わせの際は、回答と対応のため、連絡先、メッセージ、関連する通信メタデータを処理します。サービス・契約に関する場合は GDPR 第6条1項(b)、法的義務がある場合は(c)、その他は問い合わせへの回答と関連記録の保持という正当な利益に基づき(f)を法的根拠とします。",
      "문의 시 답변과 처리를 위해 연락처, 메시지 및 관련 통신 메타데이터를 처리합니다. 서비스 또는 계약 관련 문의는 GDPR 제6조 제1항 (b), 법적 의무가 있는 경우 (c), 그 밖에는 문의에 답변하고 관련 소통을 기록할 정당한 이익에 따라 (f)를 법적 근거로 합니다.",
    )],
  },
  {
    title: text("Retention and deletion", "Speicherdauer und Löschung", "Conservation et suppression", "Conservación y supresión", "保存与删除", "保存期間と削除", "보관 및 삭제"),
    paragraphs: [text(
      "We retain personal data only while it is needed for the stated purpose or while legal obligations or legal claims require it. The following criteria apply:",
      "Wir speichern personenbezogene Daten nur, solange sie für den genannten Zweck benötigt werden oder gesetzliche Pflichten beziehungsweise Rechtsansprüche dies erfordern. Es gelten folgende Kriterien:",
      "Nous ne conservons les données que pendant la durée nécessaire à la finalité indiquée ou aux obligations et droits en justice. Les critères suivants s’appliquent :",
      "Conservamos datos personales solo mientras sean necesarios para la finalidad indicada o lo exijan obligaciones o reclamaciones legales. Se aplican estos criterios:",
      "个人数据仅在实现所述目的、履行法律义务或处理法律主张所需期间保存。适用以下标准：",
      "個人データは、記載した目的、法的義務、法的請求に必要な期間に限り保存します。次の基準を適用します。",
      "개인정보는 명시된 목적, 법적 의무 또는 법적 청구에 필요한 기간에만 보관합니다. 다음 기준을 적용합니다.",
    )],
    items: [
      text("Account and guest sessions expire after 30 days. Expired database entries are removed periodically; logging out deletes the current account session.", "Konto- und Gastsitzungen laufen nach 30 Tagen ab. Abgelaufene Datenbankeinträge werden regelmäßig entfernt; beim Abmelden wird die aktuelle Kontositzung gelöscht.", "Les sessions de compte et d’invité expirent après 30 jours. Les entrées expirées sont supprimées périodiquement ; la déconnexion supprime la session de compte actuelle.", "Las sesiones de cuenta e invitado caducan a los 30 días. Las entradas caducadas se eliminan periódicamente; cerrar sesión elimina la sesión de cuenta actual.", "账户和访客会话在30天后过期。过期数据库记录会定期删除；退出登录会删除当前账户会话。", "アカウントおよびゲストセッションは30日で失効します。失効したデータベース項目は定期的に削除され、ログアウト時には現在のアカウントセッションを削除します。", "계정 및 게스트 세션은 30일 후 만료됩니다. 만료된 데이터베이스 항목은 주기적으로 삭제되며 로그아웃하면 현재 계정 세션이 삭제됩니다."),
      text("Waiting matchmaking entries are deleted after cancellation or when stale; a successful match becomes part of the game record.", "Wartende Einträge der Gegnersuche werden nach Abbruch oder bei Veralterung gelöscht; eine erfolgreiche Zuordnung wird Teil des Partiedatensatzes.", "Les entrées en attente sont supprimées après annulation ou lorsqu’elles deviennent obsolètes ; un appariement réussi rejoint le dossier de partie.", "Las entradas de emparejamiento se eliminan al cancelar o quedar obsoletas; una coincidencia correcta pasa al registro de la partida.", "等待匹配的记录会在取消或过期后删除；成功匹配会成为对局记录的一部分。", "待機中のマッチング項目はキャンセルまたは失効後に削除され、成立したマッチは対局記録の一部になります。", "대기 중인 매칭 항목은 취소되거나 오래되면 삭제되며 성사된 매칭은 대국 기록의 일부가 됩니다."),
      text("Persistent rate-limit keys become eligible for periodic deletion 48 hours after their last update. In-memory rate limits are evicted automatically and disappear when the server instance ends.", "Persistente Rate-Limit-Schlüssel werden 48 Stunden nach der letzten Aktualisierung zur regelmäßigen Löschung vorgemerkt. Flüchtige Begrenzungen werden automatisch verdrängt und enden spätestens mit der Serverinstanz.", "Les clés persistantes de limitation deviennent éligibles à la suppression périodique 48 heures après leur dernière mise à jour. Les limites en mémoire sont évincées automatiquement et disparaissent à l’arrêt de l’instance.", "Las claves persistentes de límites quedan disponibles para eliminación periódica 48 horas después de su última actualización. Los límites en memoria se descartan automáticamente y desaparecen al finalizar la instancia.", "持久化频率限制键在最后更新48小时后进入定期删除范围。内存中的限制记录会自动逐出，并在服务器实例结束时消失。", "永続的なレート制限キーは最終更新から48時間後に定期削除の対象になります。メモリ内の制限は自動的に破棄され、サーバーインスタンス終了時に消えます。", "영구 요청 제한 키는 마지막 갱신 48시간 후 주기적 삭제 대상이 됩니다. 메모리 제한은 자동으로 제거되고 서버 인스턴스 종료 시 사라집니다."),
      text("Account data, games, moves, ratings, chat, puzzle progress, and analysis are retained while needed to provide profiles, histories, rating integrity, game review, and shared opponent records. After a justified deletion request, data is deleted or separated from the account where possible; records may remain where the opponent’s rights, platform integrity, legal duties, or legal claims require this.", "Kontodaten, Partien, Züge, Wertungen, Chat, Puzzlefortschritt und Analysen werden gespeichert, solange sie für Profile, Verläufe, die Integrität von Wertungen, Partienachbetrachtung und gemeinsame Gegnerdatensätze benötigt werden. Nach einem berechtigten Löschverlangen werden Daten gelöscht oder soweit möglich vom Konto getrennt; Datensätze können verbleiben, soweit Rechte des Gegners, Plattformintegrität, gesetzliche Pflichten oder Rechtsansprüche dies erfordern.", "Les comptes, parties, coups, classements, chats, progrès et analyses sont conservés tant qu’ils sont nécessaires aux profils, historiques, à l’intégrité des classements, aux analyses et aux dossiers partagés avec l’adversaire. Après une demande d’effacement fondée, les données sont supprimées ou dissociées du compte lorsque possible ; certains dossiers peuvent rester pour les droits de l’adversaire, l’intégrité, les obligations ou droits en justice.", "Los datos de cuenta, partidas, movimientos, puntuaciones, chat, progreso y análisis se conservan mientras sean necesarios para perfiles, historiales, integridad de puntuación, revisiones y registros compartidos con oponentes. Tras una solicitud justificada se eliminan o desvinculan cuando sea posible; pueden permanecer si lo exigen derechos del oponente, integridad, obligaciones o reclamaciones legales.", "账户数据、对局、落子、等级分、聊天、题目进度和分析会在提供个人资料、历史、等级分完整性、复盘及双方共同对局记录所需期间保存。收到合理删除请求后，我们会在可行范围内删除数据或解除其与账户的关联；如对手权利、平台完整性、法律义务或法律主张要求，部分记录可能继续保留。", "アカウント、対局、着手、レーティング、チャット、問題の進行、解析は、プロフィール、履歴、レーティングの整合性、検討、相手と共有する対局記録に必要な間保存します。正当な削除請求後は可能な範囲で削除またはアカウントとの関連を解除しますが、相手の権利、プラットフォームの整合性、法的義務・請求のため記録が残る場合があります。", "계정 데이터, 대국, 수순, 레이팅, 채팅, 문제 진행 및 분석은 프로필, 기록, 레이팅 무결성, 복기 및 상대와 공유되는 대국 기록 제공에 필요한 동안 보관합니다. 정당한 삭제 요청 후 가능한 경우 삭제하거나 계정과 분리하지만 상대의 권리, 플랫폼 무결성, 법적 의무 또는 법적 청구에 필요한 기록은 남을 수 있습니다."),
      text("Account-player blocks remain until you remove them. Blocks involving a guest become eligible for periodic deletion after 30 days.", "Blockierungen zwischen Kontospielern bleiben bestehen, bis du sie aufhebst. Blockierungen mit Gastbeteiligung werden nach 30 Tagen zur regelmäßigen Löschung vorgemerkt.", "Les blocages entre comptes restent jusqu’à leur retrait. Ceux impliquant un invité deviennent éligibles à la suppression périodique après 30 jours.", "Los bloqueos entre cuentas permanecen hasta que los retires. Los que incluyen invitados quedan disponibles para eliminación periódica a los 30 días.", "账户玩家之间的屏蔽会保留至您解除。涉及访客的屏蔽在30天后进入定期删除范围。", "アカウント間のブロックは解除するまで保持されます。ゲストを含むブロックは30日後に定期削除の対象になります。", "계정 플레이어 간 차단은 해제할 때까지 유지됩니다. 게스트 관련 차단은 30일 후 주기적 삭제 대상이 됩니다."),
      text("Report records, if reporting is enabled, are retained only while needed for review, user safety, enforcement, or legal claims. Contact communications are deleted when fully resolved unless legal retention or evidence requirements apply.", "Meldedatensätze werden bei aktivierter Meldefunktion nur gespeichert, solange sie für Prüfung, Nutzerschutz, Maßnahmen oder Rechtsansprüche benötigt werden. Kontaktkommunikation wird nach vollständiger Erledigung gelöscht, sofern keine gesetzlichen Aufbewahrungs- oder Nachweispflichten bestehen.", "Les signalements, si la fonction est active, ne sont conservés que pour l’examen, la sécurité, l’application des règles ou les droits en justice. Les communications sont supprimées après résolution complète, sauf obligation légale ou probatoire.", "Las denuncias, si la función está activa, se conservan solo para revisión, seguridad, cumplimiento o reclamaciones. Las comunicaciones se eliminan al resolverse, salvo obligación legal o probatoria.", "举报功能启用时，举报记录仅在审核、用户安全、规则执行或法律主张所需期间保留。联系通信在事项完全解决后删除，除非存在法定保存或证据要求。", "通報機能が有効な場合、通報記録は審査、利用者保護、措置、法的請求に必要な期間のみ保存します。お問い合わせの記録は完全な対応後に削除しますが、法定保存・証拠要件がある場合を除きます。", "신고 기능이 활성화된 경우 신고 기록은 검토, 사용자 안전, 조치 또는 법적 청구에 필요한 동안만 보관합니다. 문의 기록은 완전히 처리된 후 삭제하되 법적 보관 또는 증빙 의무가 있는 경우는 제외합니다."),
      text("Deleted data can remain temporarily in rolling provider backups until the configured backup cycle overwrites it; it is not restored for ordinary operations.", "Gelöschte Daten können vorübergehend in rollierenden Sicherungen der Dienstleister verbleiben, bis der konfigurierte Sicherungszyklus sie überschreibt; für den normalen Betrieb werden sie nicht wiederhergestellt.", "Les données supprimées peuvent subsister temporairement dans les sauvegardes tournantes jusqu’à leur écrasement par le cycle configuré ; elles ne sont pas restaurées pour l’exploitation courante.", "Los datos eliminados pueden permanecer temporalmente en copias rotativas hasta que el ciclo configurado los sobrescriba; no se restauran para el funcionamiento ordinario.", "已删除数据可能暂时保留在服务提供商的滚动备份中，直至按配置的备份周期被覆盖；不会为日常运营而恢复。", "削除データは、設定されたバックアップ周期で上書きされるまで、委託先のローテーションバックアップに一時的に残る場合があります。通常運用のために復元することはありません。", "삭제된 데이터는 설정된 백업 주기에 따라 덮어쓸 때까지 제공업체의 순환 백업에 일시적으로 남을 수 있으며 일반 운영을 위해 복원하지 않습니다."),
    ],
  },
  {
    title: text("Security", "Datensicherheit", "Sécurité", "Seguridad", "数据安全", "安全管理", "개인정보 보안"),
    paragraphs: [text(
      "GoStone uses measures appropriate to the risk, including encrypted transport, HTTP-only and secure production cookies, password hashing, hashed session tokens, server-side authorization, input limits, database access controls, row-level security, and restricted worker access. No internet service can guarantee absolute security.",
      "GoStone setzt dem Risiko angemessene Maßnahmen ein, darunter verschlüsselte Übertragung, HTTP-only- und sichere Produktions-Cookies, Passwort-Hashing, gehashte Sitzungstokens, serverseitige Autorisierung, Eingabebegrenzungen, Datenbank-Zugriffskontrollen, Row Level Security und beschränkte Worker-Zugriffe. Kein Internetdienst kann absolute Sicherheit garantieren.",
      "GoStone applique des mesures adaptées au risque : transport chiffré, cookies de production HTTP-only et sécurisés, hachage des mots de passe et jetons, autorisation côté serveur, limites d’entrée, contrôles d’accès à la base, sécurité au niveau des lignes et accès restreint des workers. Aucun service internet ne peut garantir une sécurité absolue.",
      "GoStone aplica medidas adecuadas al riesgo: transporte cifrado, cookies de producción HTTP-only y seguras, hash de contraseñas y sesiones, autorización del servidor, límites de entrada, controles de base de datos, seguridad por filas y acceso restringido de workers. Ningún servicio de internet puede garantizar seguridad absoluta.",
      "GoStone 采取与风险相适应的措施，包括加密传输、仅限 HTTP 且生产环境安全的 Cookie、密码哈希、会话令牌哈希、服务器端授权、输入限制、数据库访问控制、行级安全和受限工作进程访问。任何互联网服务都无法保证绝对安全。",
      "GoStone は、通信の暗号化、HTTP-only・本番環境で Secure な Cookie、パスワードとセッショントークンのハッシュ化、サーバー側認可、入力制限、データベースアクセス制御、行レベルセキュリティ、ワーカーアクセス制限など、リスクに応じた措置を講じます。インターネットサービスで絶対的な安全を保証することはできません。",
      "GoStone은 암호화 전송, HTTP-only 및 프로덕션 Secure 쿠키, 비밀번호와 세션 토큰 해시, 서버 측 권한 확인, 입력 제한, 데이터베이스 접근 통제, 행 수준 보안 및 제한된 워커 접근 등 위험에 적절한 조치를 적용합니다. 어떤 인터넷 서비스도 절대적 보안을 보장할 수 없습니다.",
    )],
  },
  {
    title: text("Automated processing and required data", "Automatisierte Verarbeitung und erforderliche Angaben", "Traitement automatisé et données requises", "Tratamiento automatizado y datos necesarios", "自动处理和必要数据", "自動処理と必要なデータ", "자동 처리 및 필수 정보"),
    paragraphs: [
      text(
        "GoStone automatically performs matchmaking, rule validation, scoring, rating updates, chat filtering, rate limiting, and KataGo analysis or bot moves. These functions do not produce decisions with legal or similarly significant effects within the meaning of Article 22 GDPR. We do not create advertising profiles.",
        "GoStone führt Gegnersuche, Regelprüfung, Wertung, Rating-Änderungen, Chatfilterung, Zugriffslimits sowie KataGo-Analysen oder Bot-Züge automatisiert aus. Diese Funktionen treffen keine Entscheidungen mit rechtlicher oder ähnlich erheblicher Wirkung im Sinne von Art. 22 DSGVO. Wir erstellen keine Werbeprofile.",
        "GoStone automatise l’appariement, la validation des règles, le décompte, les classements, le filtrage du chat, les limitations et l’analyse ou les coups KataGo. Ces fonctions ne produisent aucune décision juridique ou d’effet similaire au sens de l’article 22 du RGPD. Nous ne créons pas de profils publicitaires.",
        "GoStone automatiza emparejamiento, validación de reglas, puntuación, cambios de clasificación, filtrado del chat, límites y análisis o movimientos KataGo. No producen decisiones con efectos jurídicos o similares del artículo 22 del RGPD. No creamos perfiles publicitarios.",
        "GoStone 会自动进行匹配、规则验证、计分、等级分更新、聊天过滤、频率限制以及 KataGo 分析或机器人落子。这些功能不会产生 GDPR 第22条意义上的法律或类似重大影响。我们不会建立广告画像。",
        "GoStone は、マッチング、ルール検証、採点、レーティング更新、チャットフィルター、レート制限、KataGo 解析・ボット着手を自動処理します。これらは GDPR 第22条の法的または同様に重大な効果を持つ決定ではありません。広告プロファイルは作成しません。",
        "GoStone은 매칭, 규칙 검증, 계가, 레이팅 갱신, 채팅 필터링, 요청 제한, KataGo 분석 및 봇 착점을 자동 처리합니다. 이는 GDPR 제22조의 법적 또는 이와 유사한 중대한 효과를 갖는 결정이 아닙니다. 광고 프로필을 만들지 않습니다.",
      ),
      text(
        "Technical request data is necessary to deliver and secure the service. Feature-specific data is necessary only when you use that feature. Without it, the relevant request, account, game, chat, puzzle, or analysis cannot be provided. There is no statutory obligation to provide data.",
        "Technische Anfragedaten sind für Bereitstellung und Sicherheit des Dienstes erforderlich. Funktionsbezogene Daten sind nur nötig, wenn du die jeweilige Funktion nutzt. Ohne sie kann die betreffende Anfrage, das Konto, die Partie, der Chat, das Puzzle oder die Analyse nicht bereitgestellt werden. Eine gesetzliche Pflicht zur Bereitstellung besteht nicht.",
        "Les données techniques sont nécessaires à la fourniture et à la sécurité. Les données d’une fonction ne sont nécessaires que si vous l’utilisez ; sans elles, la requête, le compte, la partie, le chat, le problème ou l’analyse ne peut être fourni. Il n’existe aucune obligation légale de fournir ces données.",
        "Los datos técnicos son necesarios para prestar y proteger el servicio. Los datos de cada función solo son necesarios si la usas; sin ellos no puede prestarse la solicitud, cuenta, partida, chat, problema o análisis correspondiente. No existe obligación legal de facilitarlos.",
        "技术请求数据是提供和保护服务所必需的。特定功能的数据仅在您使用该功能时需要；如不提供，相应请求、账户、对局、聊天、题目或分析将无法提供。法律不强制您提供这些数据。",
        "技術的リクエストデータはサービス提供と安全確保に必要です。機能ごとのデータはその機能を利用する場合にのみ必要で、提供しなければ該当するリクエスト、アカウント、対局、チャット、問題、解析を提供できません。法令上の提供義務はありません。",
        "기술적 요청 데이터는 서비스 제공과 보안에 필요합니다. 기능별 데이터는 해당 기능을 이용할 때만 필요하며, 제공하지 않으면 관련 요청, 계정, 대국, 채팅, 문제 또는 분석을 제공할 수 없습니다. 법적 제공 의무는 없습니다.",
      ),
    ],
  },
  {
    title: text("Changes to this policy", "Änderungen dieser Erklärung", "Modifications de cette politique", "Cambios en esta política", "政策变更", "本ポリシーの変更", "방침 변경"),
    paragraphs: [text(
      "We update this policy when processing activities, providers, or legal requirements change. The current version and its date are always available on this page. Material changes are communicated in an appropriate manner before they take effect where required.",
      "Wir aktualisieren diese Erklärung, wenn sich Verarbeitungsvorgänge, Dienstleister oder rechtliche Anforderungen ändern. Die aktuelle Fassung mit Datum ist stets auf dieser Seite verfügbar. Wesentliche Änderungen werden, soweit erforderlich, vor ihrem Wirksamwerden in geeigneter Weise mitgeteilt.",
      "Nous mettons cette politique à jour lorsque les traitements, prestataires ou exigences juridiques changent. La version actuelle et sa date restent disponibles ici. Les changements importants sont signalés de manière appropriée avant leur entrée en vigueur lorsque cela est requis.",
      "Actualizamos esta política cuando cambian tratamientos, proveedores o requisitos legales. La versión vigente y su fecha están siempre disponibles aquí. Los cambios importantes se comunicarán adecuadamente antes de entrar en vigor cuando sea necesario.",
      "当处理活动、服务提供商或法律要求发生变化时，我们会更新本政策。当前版本及日期始终可在本页面查看。法律要求时，重大变更会在生效前以适当方式告知。",
      "処理内容、委託先、法的要件が変わった場合、本ポリシーを更新します。現行版と日付は常に本ページで確認できます。必要な場合、重要な変更は発効前に適切な方法で通知します。",
      "처리 활동, 서비스 제공업체 또는 법적 요구사항이 변경되면 본 방침을 갱신합니다. 최신 버전과 날짜는 항상 이 페이지에서 확인할 수 있습니다. 필요한 경우 중요한 변경은 시행 전에 적절한 방식으로 알립니다.",
    )],
  },
];

const cookies = {
  title: text("Cookies and device storage", "Cookies und Gerätespeicher", "Cookies et stockage sur l’appareil", "Cookies y almacenamiento del dispositivo", "Cookie 与设备存储", "Cookie と端末ストレージ", "쿠키 및 기기 저장소"),
  intro: text(
    "GoStone currently uses only first-party cookies needed for authentication, guest play, and the language selected by the user. They are based on Section 25(2)(2) of the German Telecommunications Digital Services Data Protection Act (TDDDG); subsequent personal-data processing is based on Article 6(1)(b) GDPR or, for security, Article 6(1)(f) GDPR.",
    "GoStone verwendet derzeit ausschließlich eigene Cookies, die für Anmeldung, Gastspiel und die vom Nutzer gewählte Sprache benötigt werden. Sie beruhen auf § 25 Abs. 2 Nr. 2 TDDDG; die anschließende Verarbeitung personenbezogener Daten auf Art. 6 Abs. 1 lit. b DSGVO beziehungsweise für Sicherheitszwecke auf Art. 6 Abs. 1 lit. f DSGVO.",
    "GoStone utilise uniquement des cookies internes nécessaires à l’authentification, au jeu invité et à la langue choisie. Ils reposent sur l’article 25(2)(2) de la loi allemande TDDDG ; le traitement ultérieur repose sur l’article 6, paragraphe 1, point b) du RGPD ou, pour la sécurité, sur le point f).",
    "GoStone usa solo cookies propios necesarios para autenticación, juego como invitado y el idioma elegido. Se basan en el artículo 25.2.2 de la ley alemana TDDDG; el tratamiento posterior se basa en el artículo 6.1.b del RGPD o, para seguridad, en el artículo 6.1.f.",
    "GoStone 目前仅使用身份验证、访客游戏和用户所选语言所必需的第一方 Cookie。设备访问依据德国 TDDDG 第25条第2款第2项；后续个人数据处理依据 GDPR 第6条第1款(b)项，安全处理则依据(f)项。",
    "GoStone は現在、認証、ゲスト利用、利用者が選んだ言語に必要なファーストパーティ Cookie のみを使用します。端末への保存はドイツ TDDDG 第25条2項2号、その後の個人データ処理は GDPR 第6条1項(b)、安全目的は(f)に基づきます。",
    "GoStone은 현재 인증, 게스트 플레이 및 사용자가 선택한 언어에 필요한 자사 쿠키만 사용합니다. 기기 저장은 독일 TDDDG 제25조 제2항 제2호, 이후 개인정보 처리는 GDPR 제6조 제1항 (b), 보안 목적은 (f)에 근거합니다.",
  ),
  name: text("Name", "Name", "Nom", "Nombre", "名称", "名称", "이름"),
  purpose: text("Purpose", "Zweck", "Finalité", "Finalidad", "用途", "目的", "목적"),
  duration: text("Duration", "Dauer", "Durée", "Duración", "期限", "期間", "기간"),
  rows: [
    {
      name: "gostoned_session",
      purpose: text("Authenticates an account session; the server stores only a hash of the token.", "Authentifiziert eine Kontositzung; serverseitig wird nur ein Hash des Tokens gespeichert.", "Authentifie une session de compte ; seul le hachage du jeton est stocké côté serveur.", "Autentica una sesión de cuenta; el servidor solo guarda un hash del token.", "验证账户会话；服务器仅保存令牌的哈希。", "アカウントセッションを認証し、サーバーにはトークンのハッシュだけを保存します。", "계정 세션을 인증하며 서버에는 토큰 해시만 저장합니다."),
      duration: text("30 days; deleted earlier on logout", "30 Tage; bei Abmeldung früher gelöscht", "30 jours ; supprimé plus tôt à la déconnexion", "30 días; se elimina antes al cerrar sesión", "30天；退出登录时提前删除", "30日（ログアウト時はそれ以前に削除）", "30일, 로그아웃 시 더 일찍 삭제"),
    },
    {
      name: "gostone_guest_session",
      purpose: text("Authenticates a randomly generated guest identity for play and puzzles.", "Authentifiziert eine zufällig erzeugte Gastkennung für Partien und Puzzles.", "Authentifie une identité invité aléatoire pour les parties et problèmes.", "Autentica una identidad aleatoria de invitado para partidas y problemas.", "验证用于对局和题目的随机访客身份。", "対局と問題用にランダム生成されたゲスト ID を認証します。", "대국과 문제용으로 무작위 생성된 게스트 신원을 인증합니다."),
      duration: text("30 days", "30 Tage", "30 jours", "30 días", "30天", "30日", "30일"),
    },
    {
      name: "gostone_oauth_google / gostone_oauth_apple",
      purpose: text("Temporarily binds a Google or Apple sign-in response to the browser that started it and prevents login request forgery.", "Verknüpft die Antwort einer Google- oder Apple-Anmeldung vorübergehend mit dem Browser, der sie gestartet hat, und verhindert gefälschte Anmeldeanfragen.", "Relie temporairement la réponse Google ou Apple au navigateur qui a initié la connexion et empêche la falsification des demandes.", "Vincula temporalmente la respuesta de Google o Apple al navegador que inició la sesión y evita solicitudes falsificadas.", "临时将 Google 或 Apple 登录响应绑定到发起该流程的浏览器，并防止伪造登录请求。", "Google または Apple の応答を開始したブラウザに一時的に関連付け、ログインリクエストの偽造を防ぎます。", "Google 또는 Apple 로그인 응답을 시작한 브라우저에 일시적으로 연결하여 위조 로그인 요청을 방지합니다."),
      duration: text("10 minutes; deleted after the callback", "10 Minuten; nach dem Rückruf gelöscht", "10 minutes ; supprimé après le retour", "10 minutos; se elimina tras la respuesta", "10分钟；回调后删除", "10分（コールバック後に削除）", "10분, 콜백 후 삭제"),
    },
    {
      name: "gostone_locale",
      purpose: text("Remembers the language explicitly selected by the user.", "Merkt sich die vom Nutzer ausdrücklich gewählte Sprache.", "Mémorise la langue expressément choisie par l’utilisateur.", "Recuerda el idioma elegido expresamente por el usuario.", "记住用户明确选择的语言。", "利用者が明示的に選んだ言語を記憶します。", "사용자가 명시적으로 선택한 언어를 기억합니다."),
      duration: text("1 year", "1 Jahr", "1 an", "1 año", "1年", "1年", "1년"),
    },
  ] satisfies LocalizedCookie[],
  closing: text(
    "No analytics, advertising, cross-site tracking, or social-media cookies are used. GoStone does not currently use localStorage for personal data. If optional technologies are added later, this policy and any required consent mechanism will be updated before activation.",
    "Analyse-, Werbe-, websiteübergreifende Tracking- oder Social-Media-Cookies werden nicht eingesetzt. GoStone nutzt derzeit keinen localStorage für personenbezogene Daten. Werden später optionale Technologien ergänzt, werden diese Erklärung und eine gegebenenfalls erforderliche Einwilligungslösung vor der Aktivierung angepasst.",
    "Aucun cookie d’analyse, de publicité, de suivi intersites ou de réseau social n’est utilisé. GoStone n’utilise actuellement pas localStorage pour des données personnelles. Avant tout ajout futur de technologie facultative, cette politique et, si nécessaire, le mécanisme de consentement seront mis à jour.",
    "No se usan cookies de analítica, publicidad, seguimiento entre sitios ni redes sociales. GoStone no usa actualmente localStorage para datos personales. Si se añaden tecnologías opcionales, esta política y cualquier consentimiento necesario se actualizarán antes de activarlas.",
    "我们不使用分析、广告、跨站跟踪或社交媒体 Cookie。GoStone 目前不使用 localStorage 保存个人数据。如未来添加可选技术，我们会在启用前更新本政策及任何所需同意机制。",
    "解析、広告、クロスサイト追跡、SNS Cookie は使用していません。現在、個人データを localStorage に保存していません。将来任意技術を追加する場合、利用開始前に本ポリシーと必要な同意手段を更新します。",
    "분석, 광고, 사이트 간 추적 또는 소셜 미디어 쿠키를 사용하지 않습니다. 현재 개인정보를 localStorage에 저장하지 않습니다. 향후 선택 기술을 추가하면 활성화 전에 본 방침과 필요한 동의 절차를 갱신합니다.",
  ),
};

const processors = {
  title: text("Processors and international transfers", "Auftragsverarbeiter und Drittlandübermittlungen", "Sous-traitants et transferts internationaux", "Encargados y transferencias internacionales", "处理者与国际传输", "委託先と国外移転", "처리 수탁업체 및 국외 이전"),
  intro: text(
    "We use the following providers under data-processing agreements. They may use their documented subprocessors only to provide their services:",
    "Wir setzen folgende Dienstleister auf Grundlage von Auftragsverarbeitungsverträgen ein. Sie dürfen ihre dokumentierten Unterauftragnehmer nur zur Erbringung der jeweiligen Leistung einsetzen:",
    "Nous utilisons les prestataires suivants dans le cadre d’accords de sous-traitance. Ils ne peuvent recourir à leurs sous-traitants documentés que pour fournir leurs services :",
    "Usamos los siguientes proveedores mediante contratos de tratamiento de datos. Solo pueden usar sus subencargados documentados para prestar sus servicios:",
    "我们依据数据处理协议使用以下服务提供商。其仅可为提供相应服务而使用已记录的分处理者：",
    "当社はデータ処理契約に基づき次の事業者を利用します。各社はサービス提供のために限り、開示された再委託先を利用できます。",
    "당사는 개인정보 처리 계약에 따라 다음 업체를 이용합니다. 각 업체는 해당 서비스 제공을 위해 공개된 하위 처리업체만 이용할 수 있습니다.",
  ),
  entries: [
    {
      name: "Vercel Inc.",
      purpose: text("Website hosting, content delivery, server functions, request routing, security, and runtime logs.", "Hosting der Website, Inhaltsauslieferung, Serverfunktionen, Anfragenrouting, Sicherheit und Laufzeitprotokolle.", "Hébergement, diffusion de contenu, fonctions serveur, routage, sécurité et journaux d’exécution.", "Alojamiento, distribución de contenido, funciones de servidor, enrutamiento, seguridad y registros de ejecución.", "网站托管、内容分发、服务器函数、请求路由、安全和运行日志。", "ウェブホスティング、コンテンツ配信、サーバー関数、ルーティング、セキュリティ、ランタイムログ。", "웹 호스팅, 콘텐츠 전송, 서버 함수, 요청 라우팅, 보안 및 런타임 로그."),
      privacyUrl: "https://vercel.com/legal/privacy-policy",
    },
    {
      name: "Supabase",
      purpose: text("Managed PostgreSQL database, database connection pooling, operational database logs, and rolling backups in the project region selected by the operator.", "Verwaltete PostgreSQL-Datenbank, Datenbank-Verbindungspooling, betriebliche Datenbankprotokolle und rollierende Sicherungen in der vom Betreiber gewählten Projektregion.", "Base PostgreSQL gérée, pool de connexions, journaux opérationnels et sauvegardes tournantes dans la région de projet choisie par l’exploitant.", "Base PostgreSQL gestionada, agrupación de conexiones, registros operativos y copias rotativas en la región del proyecto elegida por el operador.", "在运营者选择的项目区域提供托管 PostgreSQL 数据库、连接池、数据库运行日志和滚动备份。", "運営者が選択したプロジェクトリージョンでのマネージド PostgreSQL、接続プール、運用ログ、ローテーションバックアップ。", "운영자가 선택한 프로젝트 지역의 관리형 PostgreSQL 데이터베이스, 연결 풀, 운영 로그 및 순환 백업."),
      privacyUrl: "https://supabase.com/privacy",
    },
    {
      name: "Modal Labs, Inc.",
      purpose: text("Isolated cloud execution of the KataGo worker for requested game analysis and puzzle generation. Normal bot moves are calculated locally in the browser and are not sent to Modal. Relevant analysis positions and moves are processed in worker memory; logs are retained according to the Modal plan.", "Isolierte Cloud-Ausführung des KataGo-Workers für angeforderte Partieanalysen und Puzzleerzeugung. Normale Bot-Züge werden lokal im Browser berechnet und nicht an Modal gesendet. Relevante Analysestellungen und Züge werden im Arbeitsspeicher verarbeitet; Protokolle werden abhängig vom Modal-Tarif gespeichert.", "Exécution cloud isolée de KataGo pour les analyses demandées et la génération de problèmes. Les coups de robot ordinaires sont calculés localement dans le navigateur et ne sont pas envoyés à Modal.", "Ejecución aislada de KataGo para análisis solicitados y generación de problemas. Los movimientos normales del bot se calculan localmente en el navegador y no se envían a Modal.", "在隔离云环境中运行 KataGo，用于用户请求的对局分析和题目生成。普通机器人落子在浏览器本地计算，不会发送到 Modal。", "依頼された対局解析と問題生成のために KataGo を隔離クラウドで実行します。通常のボット着手はブラウザー内で計算され、Modal には送信されません。", "요청된 대국 분석과 문제 생성을 위해 KataGo를 격리된 클라우드에서 실행합니다. 일반 봇 착점은 브라우저에서 로컬로 계산되며 Modal로 전송되지 않습니다."),
      privacyUrl: "https://modal.com/legal/privacy-policy",
    },
  ] satisfies LocalizedProcessor[],
  privacyLabel: text("Provider privacy information", "Datenschutzinformationen des Anbieters", "Informations du prestataire", "Información de privacidad del proveedor", "服务提供商隐私信息", "事業者のプライバシー情報", "업체 개인정보 안내"),
  transfer: text(
    "Vercel, Supabase, Modal, or their subprocessors may process data outside the European Economic Area, including in the United States or Singapore. Where no adequacy decision applies, transfers are protected by the European Commission’s Standard Contractual Clauses under Article 46 GDPR and, where necessary, supplementary safeguards. You may request information about the applicable safeguards from the controller.",
    "Vercel, Supabase, Modal oder deren Unterauftragnehmer können Daten außerhalb des Europäischen Wirtschaftsraums verarbeiten, insbesondere in den USA oder Singapur. Soweit kein Angemessenheitsbeschluss besteht, werden Übermittlungen durch die Standardvertragsklauseln der Europäischen Kommission gemäß Art. 46 DSGVO und erforderlichenfalls ergänzende Schutzmaßnahmen abgesichert. Informationen zu den anwendbaren Garantien können beim Verantwortlichen angefordert werden.",
    "Vercel, Supabase, Modal ou leurs sous-traitants peuvent traiter des données hors de l’Espace économique européen, notamment aux États-Unis ou à Singapour. En l’absence de décision d’adéquation, les transferts sont protégés par les clauses contractuelles types de la Commission européenne conformément à l’article 46 du RGPD et, si nécessaire, par des garanties supplémentaires. Vous pouvez demander des informations sur ces garanties au responsable.",
    "Vercel, Supabase, Modal o sus subencargados pueden tratar datos fuera del Espacio Económico Europeo, incluidos Estados Unidos o Singapur. Si no existe decisión de adecuación, las transferencias se protegen mediante las cláusulas contractuales tipo de la Comisión Europea conforme al artículo 46 del RGPD y, cuando sea necesario, garantías adicionales. Puedes solicitar información sobre ellas al responsable.",
    "Vercel、Supabase、Modal 或其分处理者可能在欧洲经济区之外处理数据，包括美国或新加坡。若无充分性决定，传输将依据 GDPR 第46条通过欧盟委员会标准合同条款以及必要的补充措施进行保护。您可向数据控制者索取适用保障措施的信息。",
    "Vercel、Supabase、Modal または再委託先が、米国やシンガポールを含む欧州経済領域外で処理する場合があります。十分性認定がない場合、GDPR 第46条に基づく欧州委員会の標準契約条項と必要な追加措置で移転を保護します。適用される保護措置の情報は管理者に請求できます。",
    "Vercel, Supabase, Modal 또는 하위 처리업체가 미국이나 싱가포르 등 유럽경제지역 밖에서 개인정보를 처리할 수 있습니다. 적정성 결정이 없는 경우 GDPR 제46조에 따른 EU 집행위원회 표준계약조항과 필요한 추가 보호조치로 이전을 보호합니다. 적용되는 보호조치 정보는 개인정보처리자에게 요청할 수 있습니다.",
  ),
};

const rights = {
  title: text("Your rights", "Deine Rechte", "Vos droits", "Tus derechos", "您的权利", "利用者の権利", "정보주체의 권리"),
  intro: text(
    "Subject to the legal requirements, you have the following rights regarding your personal data:",
    "Unter den gesetzlichen Voraussetzungen hast du hinsichtlich deiner personenbezogenen Daten folgende Rechte:",
    "Sous réserve des conditions légales, vous disposez des droits suivants concernant vos données :",
    "Con los requisitos legales aplicables, tienes los siguientes derechos sobre tus datos:",
    "在符合法律条件的情况下，您对自己的个人数据享有以下权利：",
    "法令上の要件を満たす場合、個人データについて次の権利があります。",
    "법적 요건에 따라 개인정보에 관해 다음 권리를 가집니다.",
  ),
  items: [
    text("access and a copy of your data (Article 15 GDPR);", "Auskunft und eine Kopie deiner Daten (Art. 15 DSGVO);", "accès et copie de vos données (article 15 du RGPD) ;", "acceso y copia de tus datos (artículo 15 del RGPD);", "访问并获得您的数据副本（GDPR 第15条）；", "データへのアクセスと写し（GDPR 第15条）。", "개인정보 열람 및 사본(제15조);"),
    text("rectification of inaccurate data (Article 16 GDPR);", "Berichtigung unrichtiger Daten (Art. 16 DSGVO);", "rectification des données inexactes (article 16) ;", "rectificación de datos inexactos (artículo 16);", "更正不准确的数据（第16条）；", "不正確なデータの訂正（第16条）。", "부정확한 개인정보 정정(제16조);"),
    text("erasure where the legal conditions are met (Article 17 GDPR);", "Löschung bei Vorliegen der gesetzlichen Voraussetzungen (Art. 17 DSGVO);", "effacement lorsque les conditions sont remplies (article 17) ;", "supresión cuando se cumplan los requisitos (artículo 17);", "在符合法律条件时删除数据（第17条）；", "要件を満たす場合の削除（第17条）。", "법적 요건 충족 시 삭제(제17조);"),
    text("restriction of processing (Article 18 GDPR);", "Einschränkung der Verarbeitung (Art. 18 DSGVO);", "limitation du traitement (article 18) ;", "limitación del tratamiento (artículo 18);", "限制处理（第18条）；", "処理の制限（第18条）。", "처리 제한(제18조);"),
    text("data portability for data processed by automated means on the basis of a contract or consent (Article 20 GDPR);", "Datenübertragbarkeit bei automatisierter Verarbeitung auf Grundlage eines Vertrags oder einer Einwilligung (Art. 20 DSGVO);", "portabilité pour les traitements automatisés fondés sur un contrat ou le consentement (article 20) ;", "portabilidad para tratamiento automatizado basado en contrato o consentimiento (artículo 20);", "对于基于合同或同意进行的自动化处理，享有数据可携权（第20条）；", "契約または同意に基づく自動処理データのポータビリティ（第20条）。", "계약 또는 동의에 따른 자동 처리 개인정보의 이동권(제20조);"),
    text("objection at any time, on grounds relating to your situation, to processing based on Article 6(1)(f) GDPR (Article 21 GDPR);", "jederzeitiger Widerspruch aus Gründen deiner besonderen Situation gegen Verarbeitungen nach Art. 6 Abs. 1 lit. f DSGVO (Art. 21 DSGVO);", "opposition, pour des raisons tenant à votre situation, aux traitements fondés sur l’article 6, paragraphe 1, point f) (article 21) ;", "oposición por motivos de tu situación a tratamientos basados en el artículo 6.1.f (artículo 21);", "基于您的具体情况，随时反对依据第6条第1款(f)项进行的处理（第21条）；", "個別の事情を理由とする、第6条1項(f)に基づく処理への異議（第21条）。", "개인 사정에 따라 제6조 제1항 (f) 처리에 언제든 이의 제기(제21조);"),
    text("withdrawal of consent at any time for future processing, if processing is based on consent; GoStone currently uses no optional consent-based tracking;", "Widerruf einer Einwilligung jederzeit für die Zukunft, falls eine Verarbeitung auf Einwilligung beruht; GoStone setzt derzeit kein optionales einwilligungsbasiertes Tracking ein;", "retrait du consentement à tout moment pour l’avenir si un traitement repose sur celui-ci ; GoStone n’utilise actuellement aucun suivi facultatif fondé sur le consentement ;", "retirada del consentimiento en cualquier momento hacia el futuro, si un tratamiento se basa en él; GoStone no usa actualmente seguimiento opcional basado en consentimiento;", "如处理基于同意，可随时撤回对未来处理的同意；GoStone 目前不使用基于同意的可选跟踪；", "同意に基づく処理の場合、将来に向けていつでも撤回できます。現在、任意の同意ベース追跡は使用していません。", "동의에 근거한 처리의 경우 향후 처리에 대한 동의를 언제든 철회할 권리; 현재 선택적 동의 기반 추적은 사용하지 않습니다;"),
    text("a complaint to a competent data protection supervisory authority, particularly in the country of your habitual residence, workplace, or the alleged infringement (Article 77 GDPR).", "Beschwerde bei einer zuständigen Datenschutzaufsichtsbehörde, insbesondere am gewöhnlichen Aufenthaltsort, Arbeitsplatz oder Ort des mutmaßlichen Verstoßes (Art. 77 DSGVO).", "réclamation auprès d’une autorité de contrôle compétente, notamment dans le pays de votre résidence habituelle, travail ou de l’infraction alléguée (article 77).", "reclamación ante una autoridad de protección de datos competente, especialmente en el país de residencia habitual, trabajo o supuesta infracción (artículo 77).", "向有管辖权的数据保护监管机构投诉，特别是您惯常居住地、工作地或涉嫌侵权发生地的机构（第77条）。", "常居所、勤務先、違反が疑われる場所を管轄するデータ保護監督機関への申立て（第77条）。", "상시 거주지, 근무지 또는 위반 추정 장소의 관할 개인정보 감독기관에 민원을 제기할 권리(제77조)."),
  ],
  contact: text(
    "Send requests to the privacy contact shown above. We may request information needed to verify your identity. Exercising your rights is generally free of charge; statutory exceptions remain unaffected.",
    "Richte Anträge an den oben genannten Datenschutzkontakt. Zur Identitätsprüfung können wir erforderliche Angaben anfordern. Die Ausübung deiner Rechte ist grundsätzlich kostenlos; gesetzliche Ausnahmen bleiben unberührt.",
    "Adressez vos demandes au contact indiqué ci-dessus. Nous pouvons demander les informations nécessaires pour vérifier votre identité. L’exercice de vos droits est en principe gratuit, sous réserve des exceptions légales.",
    "Envía las solicitudes al contacto indicado arriba. Podemos pedir la información necesaria para verificar tu identidad. El ejercicio de derechos es en general gratuito, sin perjuicio de excepciones legales.",
    "请将请求发送至上方隐私联系邮箱。我们可能要求提供核实您身份所必需的信息。行使权利通常免费，但法律规定的例外不受影响。",
    "上記の窓口へ請求してください。本人確認に必要な情報を求める場合があります。権利行使は原則無料ですが、法定の例外は除きます。",
    "위 개인정보 문의처로 요청해 주세요. 본인 확인에 필요한 정보를 요청할 수 있습니다. 권리 행사는 원칙적으로 무료이며 법적 예외는 적용될 수 있습니다.",
  ),
};

function localize(locale: Locale, value: LocalizedText): string {
  return value[locale];
}

export function getPrivacyCopy(locale: Locale): PrivacyCopy {
  return {
    kicker: localize(locale, heading.kicker),
    title: localize(locale, heading.title),
    subtitle: localize(locale, heading.subtitle),
    navLabel: localize(locale, heading.navLabel),
    metadataDescription: localize(locale, heading.metadataDescription),
    updatedLabel: localize(locale, heading.updatedLabel),
    updated: localize(locale, heading.updated),
    controller: {
      title: localize(locale, controller.title),
      intro: localize(locale, controller.intro),
      representedBy: localize(locale, controller.representedBy),
      address: localize(locale, controller.address),
      contact: localize(locale, controller.contact),
    },
    sections: sections.map((section) => ({
      title: localize(locale, section.title),
      paragraphs: section.paragraphs?.map((paragraph) => localize(locale, paragraph)) ?? [],
      items: section.items?.map((item) => localize(locale, item)) ?? [],
    })),
    cookies: {
      title: localize(locale, cookies.title),
      intro: localize(locale, cookies.intro),
      name: localize(locale, cookies.name),
      purpose: localize(locale, cookies.purpose),
      duration: localize(locale, cookies.duration),
      rows: cookies.rows.map((row) => ({
        name: row.name,
        purpose: localize(locale, row.purpose),
        duration: localize(locale, row.duration),
      })),
      closing: localize(locale, cookies.closing),
    },
    processors: {
      title: localize(locale, processors.title),
      intro: localize(locale, processors.intro),
      entries: processors.entries.map((entry) => ({
        name: entry.name,
        purpose: localize(locale, entry.purpose),
        privacyUrl: entry.privacyUrl,
      })),
      privacyLabel: localize(locale, processors.privacyLabel),
      transfer: localize(locale, processors.transfer),
    },
    rights: {
      title: localize(locale, rights.title),
      intro: localize(locale, rights.intro),
      items: rights.items.map((item) => localize(locale, item)),
      contact: localize(locale, rights.contact),
    },
  };
}
