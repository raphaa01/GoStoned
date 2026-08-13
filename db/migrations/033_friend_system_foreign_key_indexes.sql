CREATE INDEX friend_messages_sender
  ON friend_messages(sender_id);

CREATE INDEX friend_game_invites_friendship
  ON friend_game_invites(friendship_id);

CREATE INDEX friend_game_invites_game
  ON friend_game_invites(game_id)
  WHERE game_id IS NOT NULL;
