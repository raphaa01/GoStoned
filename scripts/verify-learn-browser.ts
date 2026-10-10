import assert from "node:assert/strict";
import { chromium, expect, type Page } from "@playwright/test";
import { LEARN_LESSONS, line, type LearnLesson } from "../lib/learn/curriculum";
import { allGroups, chooseLearnBotMove, createLearnGame, groupLiberties, legalLearnMoves, playLearnMove, passLearnMove, storedLearnMoves, territoryPoints, withLearnTurn } from "../lib/learn/lessonEngine";
import type { Board, BoardSize, Position } from "../lib/game/types";
import type { GoStoneBotPosition, GoStoneBotWorkerResponse, GoStoneBotMove } from "../lib/bot/modelV1";
import { boardHash, getNeighbors } from "../lib/game/goEngine";
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

async function readAccountProgress(page: Page): Promise<{progress:LearnProgress | null}> {
  // Use the real browser's cookie rules: Chromium trusts HTTP loopback, while
  // Playwright's Node request cookie jar only exempts the "localhost" hostname.
  return page.evaluate(async () => {
    const response = await fetch("/api/learn/progress",{cache:"no-store"});
    if (!response.ok) throw new Error(`Account progress returned ${response.status}`);
    return response.json();
  });
}

async function verifyBoardGeometry(page: Page) {
  const metrics = await page.locator(".interactive-learn-board").evaluate((board) => {
    const gridLines = board.querySelectorAll(".is-vertical");
    const spacing = gridLines[1].getBoundingClientRect().x - gridLines[0].getBoundingClientRect().x;
    const bounds = board.getBoundingClientRect();
    return {
      spacing,
      hitWidth: board.querySelector(".interactive-learn-board__point")!.getBoundingClientRect().width,
      stones: Array.from(board.querySelectorAll(".interactive-learn-board__stone"), (stone) => {
        const box = stone.getBoundingClientRect();
        return { width: box.width, height: box.height, inside: box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom };
      }),
    };
  });
  assert.ok(Math.abs(metrics.hitWidth / metrics.spacing - 1) < 0.02, "Touch targets must fill one grid interval without overlapping");
  for (const stone of metrics.stones) {
    assert.ok(stone.width / metrics.spacing > 0.9 && stone.width / metrics.spacing < 0.94, "Stone diameter must be 92% of grid spacing, including small teaching boards");
    assert.ok(Math.abs(stone.width - stone.height) < 1, "Stones must stay round");
    assert.ok(stone.inside, "Corner and edge stones must not be clipped");
  }
}

async function expectUnmarkedSelection(page: Page) {
  await expect(page.locator(".interactive-learn-board__point.is-emphasis, .interactive-learn-board__point.is-territory, .interactive-learn-board__point.is-black-territory, .interactive-learn-board__point.is-white-territory, .interactive-learn-board__point.is-group, .interactive-learn-board__point.is-liberty, .interactive-learn-board__point.is-last")).toHaveCount(0);
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

async function strongTestMove(page: Page, input: GoStoneBotPosition) {
  return page.evaluate(async (position) => {
    // Only the verification player uses this worker. The opponent is the unmodified app worker.
    const scope=window as unknown as {__learnBotUrl:string;__learnBotOptions?:WorkerOptions;__testPlayer?:Worker};
    const worker=scope.__testPlayer??(scope.__testPlayer=new Worker(scope.__learnBotUrl,{...scope.__learnBotOptions,name:"verification-player"}));
    const id=crypto.randomUUID();
    return new Promise<GoStoneBotMove>((resolve,reject)=>{
      const timeout=setTimeout(()=>{worker.removeEventListener("message",receive);reject(new Error("Verification player timed out"));},30000);
      const receive=(event:MessageEvent<GoStoneBotWorkerResponse>)=>{
        if(event.data.id!==id)return;
        clearTimeout(timeout);worker.removeEventListener("message",receive);
        if(event.data.ok&&event.data.kind==="move")resolve(event.data.move);
        else reject(new Error("Verification player failed"));
      };
      worker.addEventListener("message",receive);worker.postMessage({id,kind:"move",position});
    });
  },input);
}

function finishCandidate(record: ReturnType<typeof createLearnGame>):Position|null {
  let best:Position|null=null,bestScore=-Infinity;
  for(const point of legalLearnMoves(record)) {
    const neighbors=getNeighbors(record.board,point);
    if(neighbors.every((p)=>record.board[p.y][p.x]==="black"))continue; // preserve eyes
    const next=playLearnMove(record,point);if(!next.ok||(!next.captured.length&&point.liberties<2))continue;
    const rescue=neighbors.some((p)=>record.board[p.y][p.x]==="black"&&groupLiberties(record.board,p).length===1);
    const score=next.captured.length*10000+Number(rescue)*1000+territoryPoints(next.position.board,"black").length*50-territoryPoints(next.position.board,"white").length*50
      +neighbors.filter((p)=>record.board[p.y][p.x]==="black").length*12+neighbors.filter((p)=>record.board[p.y][p.x]==="white").length*6+Math.min(point.liberties,4)*4;
    if(score>bestScore){best=point;bestScore=score;}
  }
  return best;
}

async function playGame(page: Page, capture: boolean, advance: ReturnType<Page["getByRole"]>, requireWin=false) {
  let previousBlackBoard: Board | null = null;
  let record=createLearnGame(capture?5:Math.sqrt(await page.getByRole("gridcell").count()));
  for (let turn = 0; turn < 850; turn++) {
    const finish = advance;
    if (await finish.isEnabled()) return;
    const confirm = page.getByRole("button", {name: "Markierung bestätigen und zählen", exact: true});
    if (await confirm.count()) {
      await confirm.click();
      await expect(page.locator(".learn-game__score")).toBeVisible();
      if(requireWin&&!(await finish.isEnabled()))throw new Error("The verification player lost the win checkpoint; progression correctly stays locked");
      await expect(finish).toBeEnabled();
      return;
    }
    await expect(page.locator(".learn-game__status strong")).toHaveText("Du bist am Zug", {timeout: 30_000});
    const board = await readBoard(page);
    if(!capture&&record.turn==="white") {
      let white:Position|null=null;
      for(let y=0;y<board.length;y++)for(let x=0;x<board.length;x++)if(board[y][x]==="white"&&record.board[y][x]!=="white")white={x,y};
      if(white){const next=playLearnMove(record,white);assert.ok(next.ok);record=next.position;}else record=passLearnMove(record);
      assert.equal(boardHash(record.board),boardHash(board),"Observed opponent move must match the real rules");
    }
    const occupied = board.flat().filter(Boolean).length;
    const black = withLearnTurn({...createLearnGame(board.length), board,
      history:previousBlackBoard ? [boardHash(previousBlackBoard),boardHash(board)] : [boardHash(board)],
    }, "black");
    const action = capture ? null : await strongTestMove(page,{gameId:"verify-full",boardSize:board.length as BoardSize,board,moves:storedLearnMoves(record),toMove:"black",komi:6.5,targetRating:requireWin?2100:1200,gameVersion:record.moves.length});
    const rawScore=territoryPoints(board,"black").length+record.capturedWhiteByBlack-territoryPoints(board,"white").length-record.capturedBlackByWhite;
    const point = capture ? captureCandidate(board) : action?.kind==="play" ? action : requireWin&&rawScore<=6.5 ? finishCandidate(record) : null;
    if ((!point || (!requireWin&&(turn > board.length*board.length||occupied > board.length*board.length*0.8))) && !capture) {
      previousBlackBoard = board;
      await page.getByRole("button", {name: "Passen", exact: true}).click();
      if (await page.getByText(/Auf dem Brett gibt es noch offene Bereiche/).count()) await page.getByRole("button", {name: "Passen", exact: true}).click();
      record=passLearnMove(record);
    } else {
      assert.ok(point, "Capture challenge has no safe continuation");
      const played = playLearnMove(black,point);
      assert.ok(played.ok,"The verification player must also respect ko");
      previousBlackBoard = played.position.board;
      await page.getByRole("gridcell").nth(point.y * board.length + point.x).click();
      if(!capture){const next=playLearnMove(record,point);assert.ok(next.ok);record=next.position;}
    }
    await expect.poll(async () => (await page.locator(".learn-game__status strong").innerText()) !== "Bot zieht" || await page.getByRole("button", {name:"Botzug erneut berechnen"}).count() > 0, {timeout:30_000}).toBeTruthy();
    assert.equal(await page.getByRole("button", {name:"Botzug erneut berechnen"}).count(), 0, "Browser worker failed");
    if (capture) assert.equal(await page.getByText(/Weiß hat zuerst geschlagen/).count(), 0, "Capture challenge lost");
  }
  throw new Error("Game did not reach settlement");
}

async function walkLesson(page: Page, lesson: LearnLesson) {
  await page.getByRole("button", {name: `Weiterlernen: ${line(lesson.title, "de")}`, exact:true}).click();
  for (const [index, step] of lesson.steps.entries()) {
    await expect(page.getByRole("heading", {name:line(lesson.title,"de"),exact:true})).toBeVisible();
    const advance = page.getByRole("button", {name:index === lesson.steps.length - 1 ? "Lektion abschließen" : "Weiter", exact:true});
    const gameStep = step.kind.endsWith("game");
    const notice = page.locator(".learn-player__step-mode");
    await expect(notice).toHaveAttribute("data-mode", step.kind === "info" ? "info" : gameStep ? "game" : "action");
    await expect(notice.locator("strong")).toHaveText(step.kind === "info" ? "Erklärung" : gameStep ? "Partie" : "Du bist dran");
    const instruction = page.locator(".learn-player__heading .learn-teacher__speech");
    await expect(page.locator(".learn-player__heading .learn-teacher__avatar")).toHaveCount(1);
    await expect(instruction).toContainText(line(step.body,"de"));
    if (step.task) await expect(instruction.locator(".learn-teacher__task")).toHaveText(line(step.task,"de"));
    if (step.kind === "select") {
      await expectUnmarkedSelection(page);
      await expect(page.locator(".interactive-learn-board__point.is-selected")).toHaveCount(0);
      if (index === 0 && ["s1-liberties","s2-goal","s2-counting","s2-dead","s3-weak-groups"].includes(lesson.id)) {
        await page.screenshot({path:`.cache/learn-${mobile ? "mobile" : "web"}-${lesson.id}-unmarked.png`,fullPage:true});
      }
    }
    if (step.size || gameStep) await verifyBoardGeometry(page);
    if (step.kind === "capture-game" || step.kind === "guided-game" || step.kind === "beginner-game") {
      await playGame(page, step.kind === "capture-game",advance,step.requireWin);
    } else if (step.kind === "pass") {
      await page.getByRole("button", {name:"Passen",exact:true}).click();
    } else if (step.kind !== "info") {
      await expect(advance).toBeDisabled();
      if (lesson.id === "s1-liberties" && index === 0) {
        await page.getByRole("gridcell").nth(6).click();
        await expect(page.getByText(line(step.wrong!, "de"), {exact:true})).toBeVisible();
        await expect(advance).toBeDisabled();
        await expectUnmarkedSelection(page);
        await page.getByRole("button", {name:"Hinweis",exact:true}).click();
        await expect(instruction).toContainText(line(step.hint!,"de"));
        await expectUnmarkedSelection(page);
        await page.getByRole("button", {name:"Neu starten",exact:true}).click();
        await expectUnmarkedSelection(page);
      }
      const targets = step.targets?.length ? step.kind === "select" ? step.targets.slice(0,step.selectionCount??step.targets.length) : [step.targets[0]]
        : [{x: index === 1 ? 2 : index === 2 ? 3 : 1, y:2}];
      for (const [answerIndex, target] of targets.entries()) {
        await page.getByRole("gridcell").nth(target.y * step.size! + target.x).click();
        if (step.kind === "select") {
          await expect(page.locator(".interactive-learn-board__point.is-selected")).toHaveCount(answerIndex + 1);
          if (answerIndex < targets.length - 1) {
            await expect(advance).toBeDisabled();
            await expectUnmarkedSelection(page);
          }
        }
      }
      for (let reply = 0; reply < (step.replies?.length ?? 0); reply += step.replyBatch??1) {
        await page.getByRole("button", { name: /^Nächsten Zug zeigen/ }).click();
      }
      await expect(advance).toBeEnabled();
      if (lesson.id === "s1-board" && index === 2) {
        await expect(page.locator(".interactive-learn-board__point.has-stone")).toHaveCount(2);
        await page.getByRole("button", {name:"Neu starten",exact:true}).click();
        await expect(page.locator(".interactive-learn-board__point.has-stone")).toHaveCount(1);
        await expect(advance).toBeDisabled();
        await page.getByRole("gridcell").nth(targets[0].y * step.size! + targets[0].x).click();
        await expect(advance).toBeEnabled();
      }
    }
    if (step.kind === "info") {
      await expect(page.locator('.interactive-learn-board__point[aria-disabled="false"]')).toHaveCount(0);
    } else {
      await expect(notice).toHaveAttribute("data-mode", "solved");
      await expect(notice.locator("strong")).toHaveText("Erledigt");
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
    // tsx names nested callbacks when serializing evaluate(); Chromium has no such helper.
    await page.addInitScript({content:"window.__name = (fn) => fn;"});
    await page.addInitScript({content:"{ let n=0; crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++n).padStart(12,'0')}`; }"});
    await page.addInitScript(()=>{
      const Original=window.Worker;
      window.Worker=class extends Original {
        constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(options?.name==="gostone-bot-v1"){const scope=window as unknown as {__learnBotUrl:string;__learnBotOptions?:WorkerOptions};scope.__learnBotUrl=String(url);scope.__learnBotOptions=options;}}
      };
    });
    let mobileProgress: LearnProgress | null = null;
    if (mobile) await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/session") return route.fulfill({json:{ok:true,user:{id:"00000000-0000-4000-8000-000000000001",username:"learner",displayName:"Learner",playerKey:"user:00000000-0000-4000-8000-000000000001",avatarStyle:"slate"}}});
      if (path === "/api/profile/rating") return route.fulfill({json:{ok:true,rating:null}});
      if (path === "/api/profile/preferences") return route.fulfill({json:{ok:true,preferences:{boardPlacement:"direct"}}});
      if (path === "/api/profile/board-design" && route.request().method() === "GET") return route.fulfill({json:{ok:true,preference:{design:"default",wins:0}}});
      if (path === "/api/learn/progress") {
        if (route.request().method() === "PUT") {
          const input = parseLearnProgress(route.request().postDataJSON().progress);
          mobileProgress = mobileProgress ? mergeLearnProgress(input,mobileProgress) : input;
        }
        return route.fulfill({json:{ok:true,progress:mobileProgress}});
      }
      if (path === "/api/learn/game/score") {
        const body = route.request().postDataJSON();
        for (const point of body.moves) if (point !== null) assert.deepEqual(Object.keys(point).sort(),["x","y"],"Scoring moves must contain coordinates only, not worker metadata");
        return route.fulfill({json:{ok:true,result:scoreLearnGame(body.moves,body.deadStones,body.neutralRegionSeeds,body.boardSize)}});
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
    await expect(page.locator(".learn-route-node")).toHaveCount(LEARN_LESSONS.length);
    await expect(page.locator(".learn-path-stage")).toHaveCount(8);
    await expect(page.locator(".learn-path-stage.is-locked").first().locator(".learn-route-node").first()).toBeDisabled();
    await expect(page.locator('.learn-route-node[aria-current="step"]')).toContainText("Das Go-Brett");
    {
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
      await expect(page.getByText("120 von 120 Lektionen abgeschlossen",{exact:true})).toBeVisible();
      await expect.poll(async () => {
        if (mobile) return mobileProgress?.completedLessonIds.length;
        return (await readAccountProgress(page)).progress?.completedLessonIds.length;
      }).toBe(120);
      await page.reload();
      await expect(page.getByText("120 von 120 Lektionen abgeschlossen",{exact:true})).toBeVisible();
      const body = mobile ? {progress:mobileProgress!} : await readAccountProgress(page);
      assert.equal(body.progress?.completedLessonIds.length,120);
      assert.deepEqual(body.progress?.completedStages,[1,2,3,4,5,6,7,8]);
      if (!mobile) {
        const freshDevice = await browser.newContext({viewport:{width:390,height:844},storageState:{cookies:await context.cookies(),origins:[]}});
        const freshPage = await freshDevice.newPage();
        await freshPage.goto(`${baseUrl}/de/learn`);
        await expect(freshPage.getByText("120 von 120 Lektionen abgeschlossen",{exact:true})).toBeVisible();
        assert.equal((await readAccountProgress(freshPage)).progress?.completedLessonIds.length,120);
        await freshDevice.close();
      }
      await page.getByRole("button", {name:"Das Go-Brett 2 Min.", exact:true}).click();
      await expect(page.getByRole("heading", {name:"Das Go-Brett", exact:true})).toBeVisible();
      await page.getByRole("button", {name:"Lernpfad", exact:true}).click();
      await expect(page.getByText("120 von 120 Lektionen abgeschlossen", {exact:true})).toBeVisible();
      for (const width of [320,390,768]) for (const colorScheme of ["light","dark"] as const) {
        await page.setViewportSize({width,height:844});
        await page.emulateMedia({colorScheme});
        await page.evaluate(({ key, value }) => {
          localStorage.setItem(key, value);
          window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
        }, { key: mobile ? "gostone.mobile.theme.v1" : "gostone.theme.v1", value: colorScheme });
        await expect(page.locator("html")).toHaveAttribute(mobile ? "data-mobile-theme" : "data-theme", colorScheme);
        if (mobile) await page.evaluate((platform)=>{document.documentElement.dataset.mobilePlatform=platform;document.documentElement.dataset.nativeTabBar=platform === "ios" ? "true" : "false";},width === 390 ? "ios" : "android");
        await expect(page.getByRole("heading",{name:"Deine ersten Steine",exact:true})).toBeVisible();
        await page.getByRole("heading",{name:"Deine ersten Steine",exact:true}).scrollIntoViewIfNeeded();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), "Learning path overflows horizontally");
        const box = await page.locator(".learn-next-dock").boundingBox();
        assert.ok(box && box.y+box.height <= 844-(mobile ? width===390 ? 49:64:0), "Lesson button overlaps navigation");
        await page.screenshot({path:`.cache/learn-${mobile ? "mobile" : "web"}-${width}-${colorScheme}.png`});
        await page.getByRole("button",{name:"Schlagen 4 Min.",exact:true}).click();
        await expect(page.locator('.learn-player__step-mode[data-mode="action"]')).toBeVisible();
        await verifyBoardGeometry(page);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), "Lesson or task notice overflows horizontally");
        await page.screenshot({path:`.cache/learn-${mobile ? "mobile" : "web"}-capture-${width}-${colorScheme}.png`,fullPage:true});
        await page.getByRole("button",{name:"Lernpfad",exact:true}).click();
        if (width === 390) {
          await page.getByRole("button",{name:"Gruppen 3 Min.",exact:true}).click();
          await expect(page.locator('.learn-player__step-mode[data-mode="info"]')).toBeVisible();
          await expect(page.getByRole("button",{name:"Weiter",exact:true})).toBeEnabled();
          await verifyBoardGeometry(page);
          await page.screenshot({path:`.cache/learn-${mobile ? "mobile" : "web"}-explanation-${colorScheme}.png`,fullPage:true});
          await page.getByRole("button",{name:"Lernpfad",exact:true}).click();
        }
        await page.getByRole("button",{name:"Worum geht es? 3 Min.",exact:true}).click();
        await verifyBoardGeometry(page);
        await page.screenshot({path:`.cache/learn-${mobile ? "mobile" : "web"}-9x9-${width}-${colorScheme}.png`,fullPage:true});
        await page.getByRole("button",{name:"Lernpfad",exact:true}).click();
      }
    }
    console.log(mobile ? "Bundled mobile learning flow, layouts and worker passed with isolated account API fixtures." : "Authenticated beginner learning flow and account persistence passed without browser errors.");
  } finally { await browser.close(); }
}
run().catch((error:unknown)=>{ console.error(error); process.exitCode=1; }).finally(closePool);
