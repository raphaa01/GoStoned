import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { LEARN_LESSONS, lessonById } from "./curriculum";
import { allGroups, boardFromStones, createLearnGame, groupLiberties, passLearnMove, playLearnMove, pointKey, stonesFromBoard, territoryPoints, withLearnTurn } from "./lessonEngine";
import { BENT_THREE, NET, p, RACE, STRAIGHT_THREE, T_FOUR } from "./laterLessonTools";
import { boardHash, getGroup } from "@/lib/game/goEngine";
import type { Board, Position } from "@/lib/game/types";
import { completeLearnLesson, emptyLearnProgress, LEARN_LESSON_IDS, parseLearnProgress } from "./progress";
import { lessonBoardPresentation } from "./presentation";
import { scoreLearnGame } from "./gameScoring";

const keys = (points: readonly Position[]) => points.map(pointKey).sort();
const move = (board: Board, color: "black" | "white", point: Position) => {
  const result = playLearnMove(withLearnTurn({...createLearnGame(board.length),board},color),point);
  assert.ok(result.ok, `Illegal test move ${color} ${pointKey(point)}`);
  return result;
};

test("stages one to three retain their exact authored content", () => {
  // This anchored source comparison also protects feedback, positions and step order.
  const current = readFileSync("lib/learn/curriculum.ts","utf8");
  const section = (source: string) => source.slice(source.indexOf("const STAGE_ONE"),source.indexOf("export const LEARN_STAGES"));
  assert.equal(createHash("sha256").update(section(current).replaceAll("\r\n","\n")).digest("hex"),"cf60571f6819e8170f9a03d4b5ec7e6f61ee5cfe66ed7b99af94a509e09206bb");
});

test("every later stage has actionable lessons, empty selection starts and resumable real continuations", () => {
  for (const lesson of LEARN_LESSONS.filter(({stage})=>stage>=4)) {
    assert.ok(lesson.steps.some(({kind})=>kind!=="info"),lesson.id);
    assert.equal(new Set(lesson.steps.map(({id})=>id)).size,lesson.steps.length,`${lesson.id} duplicated step ID`);
    let previous: ReturnType<typeof createLearnGame> | undefined;
    for (const step of lesson.steps) {
      if (!step.size) continue;
      let state = withLearnTurn(createLearnGame(step.size,step.stones),step.toPlay??"black");
      if (step.continuePosition) {
        assert.ok(previous,`${lesson.id}/${step.id} has no preceding position`);
        assert.equal(boardHash(state.board),boardHash(previous.board),`${lesson.id}/${step.id} snapshot disagrees with continuation`);
        state = withLearnTurn(previous,step.toPlay??previous.turn);
      }
      if (step.kind==="select") {
        assert.ok((step.selectionCount??step.targets!.length)<=step.targets!.length);
        for (const wrong of [false,true]) for (const hint of [false,true]) {
          const view = lessonBoardPresentation(step,{solved:false,wrong,hint,failedAttempts:9,lastMove:p(0,0)});
          assert.deepEqual(view,{emphasis:[],group:[],territory:[],lastMove:null});
        }
      }
      if (step.kind==="play") {
        const first = playLearnMove(state,step.targets![0]);
        assert.ok(first.ok,`${lesson.id}/${step.id} cannot continue`);
        state=first.position;
        for (const reply of step.replies??[]) {
          if (reply===null) state=passLearnMove(state);
          else { const next=playLearnMove(state,reply); assert.ok(next.ok,`${lesson.id}/${step.id} reply`); state=next.position; }
        }
      }
      previous=state;
    }
  }
});

test("double atari answers put two distinct surviving groups in atari", () => {
  for (const step of lessonById("s4-double-atari").steps) {
    const board=boardFromStones(step.size!,step.stones!);
    const solutions: Position[]=[];
    for(let y=0;y<board.length;y++) for(let x=0;x<board.length;x++) {
      const next=playLearnMove(withLearnTurn({...createLearnGame(board.length),board},"black"),p(x,y));
      if(next.ok&&next.captured.length===0&&allGroups(next.position.board,"white").filter((g)=>groupLiberties(next.position.board,g[0]).length===1).length===2) solutions.push(p(x,y));
    }
    assert.deepEqual(keys(solutions),keys(step.targets!));
  }
});

test("ladder keeps the pursued group in atari, captures at the edge, and support breaks it", () => {
  for(const broken of [false,true]) {
    const steps=lessonById(broken?"s4-ladder-breaker":"s4-ladder").steps.filter(({kind})=>kind==="play");
    for(const [index,step] of steps.entries()) {
      let board=boardFromStones(7,step.stones!);
      assert.equal(groupLiberties(board,p(1,1)).length,!broken&&index===steps.length-1?1:2);
      const black=move(board,"black",step.targets![0]);board=black.position.board;
      if(index===steps.length-1&&!broken) { assert.equal(black.captured.length,10);continue; }
      assert.equal(groupLiberties(board,p(1,1)).length,1);
      const white=move(board,"white",step.replies![0]!);
      assert.equal(groupLiberties(white.position.board,p(1,1)).length,broken&&index===2?4:!broken&&index===steps.length-2?1:2);
    }
  }
});

test("snapback legally sacrifices one stone and immediately captures three, never ko", () => {
  const steps=lessonById("s4-snapback").steps;
  let state=withLearnTurn(createLearnGame(5,steps[0].stones),"black");
  let next=playLearnMove(state,steps[0].targets![0]);assert.ok(next.ok);state=next.position;
  next=playLearnMove(state,steps[0].replies![0]!);assert.ok(next.ok);assert.equal(next.captured.length,1);state=next.position;
  next=playLearnMove(state,steps[1].targets![0]);assert.ok(next.ok);assert.equal(next.captured.length,3);
  assert.equal(next.position.capturedWhiteByBlack,3);
  assert.equal(next.position.capturedBlackByWhite,1);
});

test("both exits from the net are caught, including the symmetric alternative", () => {
  const first=move(boardFromStones(5,NET),"black",p(2,2));
  for(const [escape,block,other,last] of [[p(2,1),p(2,0),p(1,2),p(0,2)],[p(1,2),p(0,2),p(2,1),p(2,0)]]) {
    let board=first.position.board;
    board=move(board,"white",escape).position.board;board=move(board,"black",block).position.board;
    board=move(board,"white",other).position.board;
    assert.equal(move(board,"black",last).captured.length,3);
  }
});

test("race counts, triangle inefficiency, connection and boundary gains match the board", () => {
  const race=boardFromStones(5,RACE);
  assert.equal(groupLiberties(race,p(0,1)).length,4);assert.equal(groupLiberties(race,p(2,1)).length,3);
  for(const [index,count] of [[0,7],[1,8]]) {
    const step=lessonById("s5-empty-triangle").steps[index];
    assert.equal(groupLiberties(boardFromStones(step.size!,step.stones!),step.stones![0]).length,count);
  }
  for(const id of ["s5-bamboo"] as const) for(const step of lessonById(id).steps) {
    let board=boardFromStones(step.size!,step.stones!);
    board=move(board,step.toPlay!,step.targets![0]).position.board;
    for(const reply of step.replies??[]) board=move(board,"black",reply!).position.board;
    assert.equal(allGroups(board,"black").length,1);
  }
  const end=lessonById("s5-big-endgame").steps[0]; const before=boardFromStones(9,end.stones!);
  assert.equal(territoryPoints(move(before,"black",p(2,0)).position.board,"black").length,4);
  assert.equal(territoryPoints(move(before,"black",p(8,7)).position.board,"black").length,1);
});

test("three and T eye spaces live when Black occupies their junction; White cannot fill any eye", () => {
  for(const [stones,vital,count] of [[STRAIGHT_THREE,p(3,3),2],[BENT_THREE,p(2,2),2],[T_FOUR,p(3,2),3]] as const) {
    const black=move(boardFromStones(7,stones),"black",vital);
    const group=getGroup(black.position.board,vital);
    const eyes=groupLiberties(black.position.board,vital);assert.equal(eyes.length,count);
    for(const eye of eyes) {
      const reply=playLearnMove(black.position,eye);assert.deepEqual(reply,{ok:false,error:"suicide"});
    }
    assert.ok(group.length>1);
  }
});

test("ko threat genuinely changes the record and permits recapture after the reply", () => {
  const steps=lessonById("s8-ko-threats").steps;const blocked=steps[0];
  let state=withLearnTurn(createLearnGame(9,blocked.stones),"white");
  state={...state,history:[boardHash(boardFromStones(9,blocked.koPreviousBoard!)),boardHash(state.board)]};
  assert.deepEqual(playLearnMove(state,p(2,2)),{ok:false,error:"ko"});
  for(const point of [p(7,6),p(6,7),p(2,2)]) { const next=playLearnMove(state,point);assert.ok(next.ok);state=next.position; }
  assert.deepEqual(playLearnMove(state,p(2,3)),{ok:false,error:"ko"});
});

test("commented games are complete replayable records scored by the server rulebook", () => {
  for(const [id,size] of [["s5-commented-game",9],["s6-commented-game",13]] as const) {
    let state=createLearnGame(size);
    for(const step of lessonById(id).steps.filter(({kind})=>kind==="play")) {
      for(const point of [step.targets![0],...(step.replies??[])]) {
        if(point===null)state=passLearnMove(state);
        else {const next=playLearnMove(state,point);assert.ok(next.ok);state=next.position;}
      }
    }
    assert.equal(state.consecutivePasses,2);
    const score=scoreLearnGame(state.moves.map(({position})=>position),[],[],size);
    assert.equal(score.score.whiteTotal-score.score.blackTotal,6.5);
    assert.equal(boardHash(score.board),boardHash(state.board));
    assert.ok(stonesFromBoard(state.board).length>size);
  }
  assert.equal(scoreLearnGame([p(18,18),p(0,0),null,null],[],[],19).board.length,19);
  assert.throws(()=>scoreLearnGame([p(18,18),p(0,0),null,null],[],[],9));
});

test("legacy progress advances into stage four; a failed win checkpoint never unlocks stage six", () => {
  let progress=parseLearnProgress({...emptyLearnProgress(),completedLessonIds:LEARN_LESSON_IDS.slice(0,31)});
  assert.deepEqual(progress.completedStages,[1,2,3]);
  for(const id of LEARN_LESSON_IDS.slice(31).filter((id)=>id.startsWith("s4-")||id.startsWith("s5-"))) {
    if(id!=="s5-win-game")progress=completeLearnLesson(progress,id,Number(id[1]));
  }
  const lost=completeLearnLesson(progress,"s5-win-game",5,"lost");
  assert.equal(lost.currentLessonId,"s5-win-game");assert.ok(!lost.completedStages.includes(5));
  assert.equal(lost.challengeResults["s5-win-game"]?.attempts,1);
  const won=completeLearnLesson(lost,"s5-win-game",5,"won");
  assert.ok(won.completedStages.includes(5));assert.equal(won.currentLessonId,"s6-bigger");
  assert.equal(won.challengeResults["s5-win-game"]?.attempts,2);
});
