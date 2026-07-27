export const bannedWords = [
  "fuck", "fucking", "fck", "shit", "bullshit", "bitch", "asshole", "bastard", "dick", "prick",
  "cunt", "slut", "whore", "motherfucker", "mf", "wtf", "stfu", "kys", "kill yourself", "go die",
  "suicide", "hang yourself", "retard", "idiot", "moron", "loser", "trash", "ez trash", "bot",
  "cheater", "hacker", "scammer", "scam", "dox", "doxx", "doxxing", "address leak", "ip grabber", "grabify",
  "discord token", "password", "passwort", "credit card", "kreditkarte", "nude", "nudes", "porn", "sex", "sexting",
  "rape", "rapist", "molest", "pedo", "pedophile", "onlyfans", "weed", "joint", "cannabis", "marijuana",
  "thc", "cocaine", "coke", "meth", "heroin", "lsd", "ecstasy", "mdma", "xanax", "lean",
  "nazi", "hitler", "heil", "holocaust joke", "terrorist", "isis", "bomb", "bombing", "school shooter", "shooting",
  "stab", "knife threat", "kill", "murder", "death threat", "racist", "racism", "homophobe", "homophobic", "sexist",
  "misogynist", "antisemitic", "antisemitism", "ableist", "slur", "hate speech", "hurensohn", "hure", "arschloch", "wichser",
] as const;

const leetCharacters: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
  "!": "i",
};

function normalizeForModeration(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[013457@]/g, (character) => leetCharacters[character] ?? character)
    .replace(/[$!](?=[a-z0-9])/g, (character) => leetCharacters[character] ?? character)
    .replace(/(.)\1{2,}/g, "$1");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createBlockedPattern(term: string): RegExp {
  const normalized = normalizeForModeration(term);
  const characters = [...normalized.replace(/[^a-z0-9]+/g, "")];
  const flexibleTerm = characters.map(escapeRegex).join("[^a-z0-9]*");
  return new RegExp(`(?:^|[^a-z0-9])${flexibleTerm}(?:$|[^a-z0-9])`, "i");
}

const bannedPatterns = bannedWords.map(createBlockedPattern);

export function containsBannedChatContent(message: string): boolean {
  const normalized = normalizeForModeration(message);
  return bannedPatterns.some((pattern) => pattern.test(normalized));
}
