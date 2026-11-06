import type { BoardSize, TimeControlId } from "@/lib/game/types";

export type TournamentFormat = "round_robin" | "knockout" | "league";
export type TournamentSettings = {
  name: string;
  boardSize: BoardSize;
  timeControl: TimeControlId;
  maxPlayers: number;
  format: Exclude<TournamentFormat, "league">;
};
export type Tournament = {
  id: string;
  kind: "private" | "monthly";
  hostId: string | null;
  name: string;
  code: string | null;
  month: string | null;
  category: number | null;
  format: TournamentFormat;
  boardSize: BoardSize;
  timeControl: TimeControlId;
  maxPlayers: number;
  status: "lobby" | "running" | "finished" | "cancelled";
  round: number;
  startsAt: string;
  endsAt: string | null;
  memberCount: number;
};
export type Standing = {
  userId: string;
  name: string;
  rating: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  played: number;
  tiebreak: number;
  place: number;
};
export type TournamentMatch = {
  id: string;
  round: number;
  blackId: string | null;
  whiteId: string | null;
  blackName: string;
  whiteName: string;
  blackReady: boolean;
  whiteReady: boolean;
  readyDeadline: string | null;
  status: "pending" | "playing" | "finished" | "void";
  gameId: string | null;
  winnerId: string | null;
  result: string | null;
};
export type TournamentDetail = {
  tournament: Tournament;
  standings: Standing[];
  matches: TournamentMatch[];
  joined: boolean;
  queueUntil: string | null;
  userId: string;
};
export type TournamentDashboard = {
  eligible: boolean;
  ratedGames: number;
  canHost: boolean;
  category: number;
  monthly: Tournament[];
  mine: Tournament[];
  invitations: Tournament[];
};
export type TournamentTrophy = {
  tournamentId: string;
  name: string;
  month: string | null;
  category: number | null;
  place: number;
  displayed: boolean;
};
