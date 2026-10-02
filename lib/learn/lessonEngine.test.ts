import assert from "node:assert/strict";
import test from "node:test";
import { boardHash, getGroup } from "@/lib/game/goEngine";
import {
  boardFromStones,
  chooseLearnBotMove,
  createLearnGame,
  groupLiberties,
  learnReviewMoments,
  passLearnMove,
  playLearnMove,
  withLearnTurn,
} from "./lessonEngine";

test("the learning engine captures, rejects suicide, and enforces simple ko", () => {
  const capture = withLearnTurn(createLearnGame(5, [
    { x: 2, y: 2, color: "white" },
    { x: 2, y: 1, color: "black" },
    { x: 1, y: 2, color: "black" },
    { x: 3, y: 2, color: "black" },
  ]), "black");
  const captured = playLearnMove(capture, { x: 2, y: 3 });
  assert.ok(captured.ok);
  assert.equal(captured.captured.length, 1);

  const suicide = withLearnTurn(createLearnGame(5, [
    { x: 2, y: 1, color: "white" }, { x: 1, y: 2, color: "white" },
    { x: 3, y: 2, color: "white" }, { x: 2, y: 3, color: "white" },
  ]), "black");
  assert.deepEqual(playLearnMove(suicide, { x: 2, y: 2 }), { ok: false, error: "suicide" });

  const before = [
    { x: 2, y: 2, color: "white" as const }, { x: 1, y: 3, color: "white" as const },
    { x: 3, y: 3, color: "white" as const }, { x: 2, y: 4, color: "white" as const },
    { x: 2, y: 1, color: "black" as const }, { x: 1, y: 2, color: "black" as const },
    { x: 3, y: 2, color: "black" as const },
  ];
  const koCapture = playLearnMove(withLearnTurn(createLearnGame(5, before), "black"), { x: 2, y: 3 });
  assert.ok(koCapture.ok);
  if (!koCapture.ok) return;
  const koPosition = {
    ...koCapture.position,
    history: [boardHash(boardFromStones(5, before)), boardHash(koCapture.position.board)],
  };
  assert.deepEqual(playLearnMove(koPosition, { x: 2, y: 2 }), { ok: false, error: "ko" });
  const elsewhere = playLearnMove(koPosition, {x:0,y:4});
  assert.ok(elsewhere.ok);
  const response = playLearnMove(elsewhere.position, {x:4,y:0});
  assert.ok(response.ok);
  const recapture = playLearnMove(response.position, {x:2,y:2});
  assert.ok(recapture.ok);
  assert.equal(recapture.captured.length,1);
});

test("the local teaching bots only choose legal moves and passes preserve the board", () => {
  for (const size of [5, 9]) {
    const position = createLearnGame(size);
    const move = chooseLearnBotMove(position);
    assert.ok(move);
    assert.ok(playLearnMove(position, move!).ok);
    const passed = passLearnMove(position);
    assert.equal(boardHash(passed.board), boardHash(position.board));
    assert.equal(passed.consecutivePasses, 1);
  }
});

test("group liberty helpers count shared liberties once", () => {
  const position = createLearnGame(5, [
    { x: 2, y: 2, color: "black" },
    { x: 3, y: 2, color: "black" },
  ]);
  const group = getGroup(position.board, { x: 2, y: 2 });
  assert.equal(group.length, 2);
  assert.equal(groupLiberties(position.board, group[0]).length, 6);
});

test("learning reviews use the player's actual pre-capture position", () => {
  let position = createLearnGame(9);
  for (const point of [{x:1,y:0},{x:0,y:0},{x:0,y:1}]) {
    const played = playLearnMove(position,point);
    assert.ok(played.ok);
    position = played.position;
  }
  const reviews = learnReviewMoments(position);
  assert.ok(reviews.length <= 3);
  const capture = reviews.find((moment)=>moment.kind === "reviewCapture");
  assert.ok(capture);
  assert.equal(capture.board[0][0],"white");
  assert.deepEqual(capture.group,[{x:0,y:0}]);
  assert.deepEqual(capture.emphasis,[{x:0,y:1}]);
  assert.equal(capture.count,1);
});

test("worker move metadata never leaks into the persisted scoring record", () => {
  const workerMove = {kind:"play" as const,x:2,y:3};
  const played = playLearnMove(createLearnGame(9),workerMove);
  assert.ok(played.ok);
  assert.deepEqual(played.position.moves[0].position,{x:2,y:3});
  assert.deepEqual(Object.keys(played.position.moves[0].position!).sort(),["x","y"]);
});
