import assert from "node:assert/strict";
import { chromium, expect, type Page } from "@playwright/test";
import { LEARN_LESSONS, line, type LearnLesson } from "../lib/learn/curriculum";
import { allGroups, chooseLearnBotMove, createLearnGame, groupLiberties, legalLearnMoves, playLearnMove, withLearnTurn } from "../lib/learn/lessonEngine";
import type { Board, Position } from "../lib/game/types";
import { scoreLearnGame } from "../lib/learn/gameScoring";
import "dotenv/config";
import { closePool, getPool } from "../lib/db";
import { getDatabaseUrl, isUnambiguousLocalDatabase } from "../lib/env";
import { assertSmokeDatabaseIdentity } from "../lib/smokeDatabase";
import { mergeLearnProgress, parseLearnProgress, type LearnProgress } from "../lib/learn/progress";

const mobile = process.env.LEARN_CLIENT === "mobile";
const baseUrl = process.env.BASE_URL ?? (mobile ? "http://127.0.0.1:4173" : "http://127.0.0.1:3101");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname), "Browser verification is local-only.");

async function readBoard(page: Page): Promise<Board> {
  const cells = await page.getByRole("gridcell").evaluateAll((elements) => elements.map((element) => ({
    label: element.getAttribute("aria-label")!, row: Number(element.parentElement!.getAttribute("aria-rowindex")), column: Number(element.getAttribute("aria-colindex")),
  })));
  const size = Math.sqrt(cells.length);
  const board = createLearnGame(size).board;
  cells.forEach(({label, row, column}) => { board[row - 1][column - 1] = label.startsWith("Schwarzer") ? "black" : label.startsWith("Weißer") ? "white" : null; });
  return board;
}

function captureCandidate(board: Board): Position | null {
  const position = createLearnGame(board.length);
  const black = {...position, board};
  let best: Position | null = null;
  let bestScore = -Infinity;
  for (const move of legalLearnMoves(black)) {
    const next = playLearnMove(black, move);
    if (!next.ok) continue;
    if (next.captured.length) return move;
    const reply = chooseLearnBotMove(next.position);
    const after = reply ? playLearnMove(next.position, reply) : null;
    if (after?.ok && after.captured.length) continue;
    const pressure = allGroups(next.position.board, "white").reduce((score, group) => score + 20 / groupLiberties(next.position.board, group[0]).length, 0);
    const score = pressure + move.liberties * 2;
    if (score > bestScore) {best = move; bestScore = score;}
  }
  return best;
}

async function playGame(page: Page, capture: boolean) {
  for (let turn = 0; turn < 220; turn++) {
    const finish = page.getByRole("button", {name: "Lektion abschließen", exact: true});
    if (await finish.isEnabled()) return;
    const confirm = page.getByRole("button", {name: "Markierung bestätigen und zählen", exact: true});
    if (await confirm.count()) {
      await confirm.click();
      await expect(finish).toBeEnabled();
      return;
    }
    await expect(page.locator(".learn-game__status strong")).toHaveText("Du bist am Zug", {timeout: 30_000});
    const board = await readBoard(page);
    const occupied = board.flat().filter(Boolean).length;
    const black = withLearnTurn({...createLearnGame(board.length), board}, "black");
    const point = capture ? captureCandidate(board) : chooseLearnBotMove(black);
    if ((!point || turn > 90 || occupied > 62) && !capture) {
      await page.getByRole("button", {name: "Passen", exact: true}).click();
      if (await page.getByText(/Auf dem Brett gibt es noch offene Bereiche/).count()) await page.getByRole("button", {name: "Passen", exact: true}).click();
    } else {
      assert.ok(point, "Capture challenge has no safe continuation");
      await page.getByRole("gridcell").nth(point.y * board.length + point.x).click();
    }
    await expect.poll(async () => (await page.locator(".learn-game__status strong").innerText()) !== "Bot zieht" || await page.getByRole("button", {name:"Botzug erneut berechnen"}).count() > 0, {timeout:30_000}).toBeTruthy();
    assert.equal(await page.getByRole("button", {name:"Botzug erneut berechnen"}).count(), 0, "Browser worker failed");
    if (capture) assert.equal(await page.getByText(/Weiß hat zuerst geschlagen/).count(), 0, "Capture challenge lost");
  }
  throw new Error("Game did not reach settlement");
}

async function walkLesson(page: Page, lesson: LearnLesson) {
  {
    const nextStage = page.getByRole("button", {name: /^Nächste Etappe:/});
    if (await nextStage.count()) await nextStage.click();
    await page.getByRole("button", {name: `Nächste Lektion: ${line(lesson.title, "de")}`, exact:true}).click();
  }
  for (const [index, step] of lesson.steps.entries()) {
    await expect(page.getByRole("heading", {name:line(lesson.title,"de"),exact:true})).toBeVisible();
    const advance = page.getByRole("button", {name:index === lesson.steps.length - 1 ? "Lektion abschließen" : "Weiter", exact:true});
    if (step.kind === "capture-game" || step.kind === "guided-game" || step.kind === "beginner-game") {
      await playGame(page, step.kind === "capture-game");
    } else if (step.kind === "pass") {
      await page.getByRole("button", {name:"Passen",exact:true}).click();
    } else if (step.kind !== "info") {
      await expect(advance).toBeDisabled();
      if (lesson.id === "s1-liberties" && index === 0) {
        await page.getByRole("gridcell").nth(6).click();
        await expect(page.getByText(line(step.wrong!, "de"), {exact:true})).toBeVisible();
        await expect(advance).toBeDisabled();
      }
      const targets = step.targets?.length ? step.kind === "select" ? step.targets : [step.targets[0]]
        : [{x: index === 1 ? 2 : index === 2 ? 3 : 1, y:2}];
      for (const target of targets) await page.getByRole("gridcell").nth(target.y * step.size! + target.x).click();
      await expect(advance).toBeEnabled();
    }
    await expect(advance).toBeEnabled();
    await advance.click();
  }
  console.log(`Verified ${lesson.id}: ${lesson.steps.length} interactive screens`);
}

async function run() {
  if (!mobile) {
    assert.ok(isUnambiguousLocalDatabase(getDatabaseUrl()), "Learning verification requires an isolated local database.");
    await assertSmokeDatabaseIdentity(getPool());
  }
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page = await context.newPage();
    let mobileProgress: LearnProgress | null = null;
    if (mobile) await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/session") return route.fulfill({json:{ok:true,user:{id:"00000000-0000-4000-8000-000000000001",username:"learner",displayName:"Learner",playerKey:"user:00000000-0000-4000-8000-000000000001",avatarStyle:"slate"}}});
      if (path === "/api/profile/rating") return route.fulfill({json:{ok:true,rating:null}});
      if (path === "/api/profile/preferences") return route.fulfill({json:{ok:true,preferences:{boardPlacement:"direct"}}});
      if (path === "/api/learn/progress") {
        if (route.request().method() === "PUT") {
          const input = parseLearnProgress(route.request().postDataJSON().progress);
          mobileProgress = mobileProgress ? mergeLearnProgress(input,mobileProgress) : input;
        }
        return route.fulfill({json:{ok:true,progress:mobileProgress}});
      }
      if (path === "/api/learn/game/score") {
        const body = route.request().postDataJSON();
        return route.fulfill({json:{ok:true,result:scoreLearnGame(body.moves,body.deadStones,body.neutralRegionSeeds)}});
      }
      throw new Error(`Unexpected mobile API request ${path}`);
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") console.error("Browser:", message.text()); });
    if (!mobile) {
      const registered = await context.request.post(`${baseUrl}/api/auth/register`, {data:{username:`learn_${crypto.randomUUID().slice(0,8)}`,password:crypto.randomUUID(),startingStrength:"unspecified",knownRank:null,boardPlacement:"zoom"}});
      assert.equal(registered.status(),201);
    }
    await page.goto(`${baseUrl}/de/learn`);
    {
      await page.getByRole("button", {name:"Weiterlernen: Das Go-Brett",exact:true}).click();
      const dock = await page.locator(".learn-next-dock").boundingBox();
      assert.ok(dock && dock.y + dock.height <= 844);
    }
    try {
      for (const lesson of LEARN_LESSONS) {
        await walkLesson(page, lesson);
        if (lesson.id === "s1-atari") await page.screenshot({path:`.cache/learn-${mobile ? "mobile" : "web"}-current-path.png`});
      }
    } catch (error) {
      console.error("Page errors:", errors, "Visible state:", await page.locator("body").innerText());
      await page.screenshot({path:".cache/learn-browser-failure.png"});
      throw error;
    }
    assert.deepEqual(errors,[]);
    {
      await expect(page.getByText("12 von 12 Lektionen abgeschlossen",{exact:true})).toBeVisible();
      await expect.poll(async () => {
        if (mobile) return mobileProgress?.completedLessonIds.length;
        const response = await context.request.get(`${baseUrl}/api/learn/progress`);
        return (await response.json()).progress?.completedLessonIds.length;
      }).toBe(31);
      await page.reload();
      await expect(page.getByText("31 von 31 Lektionen abgeschlossen",{exact:true})).toBeVisible();
      const body = mobile ? {progress:mobileProgress!} : await (await context.request.get(`${baseUrl}/api/learn/progress`)).json();
      assert.equal(body.progress.completedLessonIds.length,31);
      assert.deepEqual(body.progress.completedStages,[1,2,3]);
      await page.getByRole("button").filter({hasText:"Deine ersten Steine"}).click();
      await page.getByRole("button", {name:"Das Go-Brett 2 Min.", exact:true}).click();
      await expect(page.getByRole("heading", {name:"Das Go-Brett", exact:true})).toBeVisible();
      await page.getByRole("button", {name:"Lernpfad", exact:true}).click();
      await page.getByRole("button", {name:"Etappen", exact:true}).click();
      await expect(page.getByText("31 von 31 Lektionen abgeschlossen", {exact:true})).toBeVisible();
      for (const width of [320,390,768]) for (const colorScheme of ["light","dark"] as const) {
        await page.setViewportSize({width,height:844});
        await page.emulateMedia({colorScheme});
        if (mobile) await page.evaluate((platform)=>{document.documentElement.dataset.mobilePlatform=platform;document.documentElement.dataset.nativeTabBar=platform === "ios" ? "true" : "false";},width === 390 ? "ios" : "android");
        await page.getByRole("button").filter({hasText:"Deine ersten Steine"}).click();
        await expect(page.getByRole("heading",{name:"Deine ersten Steine",exact:true})).toBeVisible();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), "Learning path overflows horizontally");
        const box = await page.locator(".learn-next-dock").boundingBox();
        assert.ok(box && box.y+box.height <= 844-(mobile ? width===390 ? 49:64:0), "Lesson button overlaps navigation");
        await page.screenshot({path:`.cache/learn-${mobile ? "mobile" : "web"}-${width}-${colorScheme}.png`});
        await page.getByRole("button",{name:"Etappen",exact:true}).click();
      }
    }
    console.log(mobile ? "Bundled mobile learning flow, layouts and worker passed with isolated account API fixtures." : "Authenticated beginner learning flow and account persistence passed without browser errors.");
  } finally { await browser.close(); }
}
run().catch((error:unknown)=>{ console.error(error); process.exitCode=1; }).finally(closePool);
