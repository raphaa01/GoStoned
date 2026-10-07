import { expect, test } from "@playwright/test";
import { installHarness, assertNoOverflow, USER } from "./boardDesignHarness";
import { IMPORTED_PUZZLES } from "../../lib/puzzles/importedCatalog";
import type { PuzzlePly, PuzzleView } from "../../lib/puzzles/types";
import { emptyLearnProgress } from "../../lib/learn/progress";
import { LEARN_LESSONS } from "../../lib/learn/curriculum";

export function registerLearningPuzzleTests(mobile: boolean) {
  // The website's server-side account gate is exercised by verify-learn-browser
  // with a real PostgreSQL session; a client API mock cannot authorize it.
  if (mobile) test("learning opens at current progress and exposes every locked stage above it", async ({page}) => {
    await installHarness(page);
    const completed=LEARN_LESSONS.slice(0,13).map((lesson)=>lesson.id);
    const current=LEARN_LESSONS[13];
    const progress={...emptyLearnProgress(),completedLessonIds:completed,currentLessonId:current.id,updatedAt:new Date().toISOString()};
    await page.route("**/api/learn/progress",async(route)=>route.fulfill({json:{ok:true,progress}}));
    await page.goto("/de/learn");
    await expect(page.locator(".learn-route-node")).toHaveCount(LEARN_LESSONS.length);
    const node=page.locator('.learn-route-node[aria-current="step"]');
    await expect(node).toContainText(current.title.de);
    await expect.poll(async()=>{const box=await node.boundingBox();return !!box && box.y>0 && box.y+box.height<page.viewportSize()!.height-100;}).toBe(true);
    const locked=page.locator(".learn-path-stage.is-locked").first();
    await expect(locked.locator(".learn-route-node").first()).toBeDisabled();
    await locked.scrollIntoViewIfNeeded();
    await expect(locked.getByRole("heading")).toBeVisible();
    await expect.poll(async()=>{const currentBox=await node.boundingBox();const futureBox=await locked.boundingBox();return futureBox!.y<currentBox!.y;}).toBe(true);
    await assertNoOverflow(page);
    await page.locator(".learn-next-dock__button").click();
    await expect(page.getByRole("heading",{name:current.title.de,exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Lernpfad",exact:true}).click();
    await expect(node).toContainText(current.title.de);
    await expect.poll(async()=>{const box=await node.boundingBox();return !!box&&box.y>0&&box.y<page.viewportSize()!.height-100;}).toBe(true);
  });

  test("practice opens directly, plays the whole wrong branch, undoes it, and advances to an unsolved puzzle", async({page})=>{
    await installHarness(page);
    const source=IMPORTED_PUZZLES.find((puzzle)=>puzzle.paths[1].line.length===6 && puzzle.paths[1].line.some((ply)=>ply.move==="pass" && ply.color===puzzle.toPlay))!;
    const wrong=source.paths[1].line;
    let progress:PuzzlePly[]=[];
    let revision=0;
    let solved=false;
    let activeWrong=false;
    let attempts=0;
    const view=():PuzzleView=>({id:source.id,kind:"practice",category:null,rankKyu:source.rankKyu,collectionOrder:1,dailyDate:null,boardSize:19,toPlay:source.toPlay,board:source.board,difficulty:"beginner",publishedAt:"2026-10-07T00:00:00Z",attemptCount:attempts,solved,firstAttemptCorrect:false,variationProgress:progress,variationRevision:revision,solution:solved?{...source.paths[0].line[0],line:source.paths[0].line,explanation:source.paths[0].explanation}:null,viewportSize:source.viewportSize,targetStones:source.target,goal:source.goal});
    await page.route("**/api/puzzles**",async(route)=>{
      const request=route.request();
      if(new URL(request.url()).pathname.endsWith("/attempt")) {
        const move=request.postDataJSON();
        expect(move.revision).toBe(revision);
        attempts++;revision++;
        let outcome="continue";
        let displayLine:PuzzlePly[]=[];
        if(move.action==="undo") {progress=progress.slice(0,-2);}
        else {
          if(!progress.length)activeWrong=move.x===wrong[0].x&&move.y===wrong[0].y;
          const line=activeWrong?wrong:source.paths[0].line;
          if (move.action === "pass") expect(line[progress.length].move).toBe("pass");
          else expect({x:move.x,y:move.y}).toEqual({x:line[progress.length].x,y:line[progress.length].y});
          progress=line.slice(0,progress.length+2);displayLine=progress;
          if(progress.length===line.length) {outcome=activeWrong?"retry":"solved";solved=!activeWrong;if(activeWrong)progress=[];}
        }
        await route.fulfill({json:{ok:true,actor:USER.playerKey,attempt:{puzzleId:source.id,correct:outcome!=="retry",outcome,solved,attemptCount:attempts,firstAttemptCorrect:false,variationProgress:progress,variationRevision:revision,displayLine,displayLineIsComplete:true,feedback:null,solution:view().solution}}});
      } else {
        const current=view();
        await route.fulfill({json:{ok:true,actor:USER.playerKey,status:"ready",mode:"practice",expectedPerCategory:0,categoryCounts:{},dailyCycleLength:61,puzzles:[{...current,id:"already-solved",solved:true},current,{...current,id:"remaining",rankKyu:5,collectionOrder:2,solved:false,solution:null}]}});
      }
    });
    await page.goto("/puzzles?mode=practice");
    const board=page.locator(".go-board");
    await expect(board).toBeVisible();
    await expect(page.getByText("Choose a category",{exact:true})).toHaveCount(0);
    const play=async(ply:PuzzlePly)=>{
      await Promise.all([page.waitForResponse((response)=>response.url().endsWith("/attempt")),ply.move === "pass" ? page.getByRole("button", {name:"Pass",exact:true}).click() : board.getByRole("gridcell").nth(ply.y*source.viewportSize+ply.x).click()]);
      await expect(page.getByRole("region",{name:"Find the strongest move.",exact:true})).toHaveAttribute("aria-busy","false");
    };
    await play(wrong[0]);
    await expect(page.getByText("Not quite.",{exact:true})).toHaveCount(0);
    await page.getByRole("button",{name:"Undo move",exact:true}).click();
    await expect.poll(()=>progress.length).toBe(0);
    for(const ply of wrong.filter((ply)=>ply.color===source.toPlay))await play(ply);
    await expect(page.getByText("Not quite.",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Undo move",exact:true}).click();
    await expect(page.getByText("Not quite.",{exact:true})).toHaveCount(0);
    for(const ply of source.paths[0].line.filter((ply)=>ply.color===source.toPlay))await play(ply);
    await expect.poll(()=>solved).toBe(true);
    await page.getByRole("button",{name:"Next problem",exact:true}).click();
    await expect(page.getByText("about 5 kyu",{exact:true}).first()).toBeVisible();
    await assertNoOverflow(page);
  });
}
