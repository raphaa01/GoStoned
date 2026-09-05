import type { BoardSize, TimeControlId } from "@/lib/game/types";
import type { ProfileAvatarStyle } from "@/lib/profileAvatar";

export type FriendPresence = "online" | "playing" | "offline";
export type FriendshipStatus = "none" | "incoming" | "outgoing" | "friends";

export type FriendSummary = {
  friendshipId: string;
  userId: string;
  username: string;
  displayName: string;
  avatarStyle: ProfileAvatarStyle;
  presence: FriendPresence;
  unreadCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
};

export type FriendRequestSummary = {
  friendshipId: string;
  userId: string;
  username: string;
  displayName: string;
  avatarStyle: ProfileAvatarStyle;
  direction: "incoming" | "outgoing";
  createdAt: string;
};

export type FriendMessage = {
  id: string;
  friendshipId: string;
  senderId: string;
  senderName: string;
  message: string;
  createdAt: string;
};

export type FriendGameInvite = {
  id: string;
  friendshipId: string;
  inviterId: string;
  inviteeId: string;
  otherPlayerName: string;
  boardSize: BoardSize;
  timeControl: TimeControlId;
  direction: "incoming" | "outgoing";
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  gameId: string | null;
  createdAt: string;
  expiresAt: string;
};

export type FriendsDashboard = {
  friends: FriendSummary[];
  requests: FriendRequestSummary[];
  invites: FriendGameInvite[];
};

export type PlayerSearchResult = {
  userId: string;
  username: string;
  displayName: string;
  avatarStyle: ProfileAvatarStyle;
  presence: FriendPresence;
  friendshipId: string | null;
  friendshipStatus: FriendshipStatus;
};

export type FriendProfile = {
  userId: string;
  username: string;
  displayName: string;
  avatarStyle: ProfileAvatarStyle;
  presence: FriendPresence;
  joinedAt: string;
  rating: number | null;
  ratedGames: number;
  friendlyGames: number;
  sharedFriendlyGames: number;
  friendshipId: string | null;
  friendshipStatus: FriendshipStatus;
};
