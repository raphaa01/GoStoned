import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gamePollResponseBody } from "../../lib/game/gamePolling";
import { GAME_ID, USER, gameFor } from "../shared/boardDesignHarness";

const app = process.argv[2];
if (!app) throw new Error("Provide the built iOS Simulator App.app path.");
const configPath = join(app, "capacitor.config.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
config.loggingBehavior = "production";
writeFileSync(configPath, JSON.stringify(config));

const game = { ...gameFor(9, "friendly"), status: "finished", turn: null, result: "B+R", finishReason: "resignation" } as const;
const body = gamePollResponseBody({ game }, USER.playerKey);
const script = `(${runReview.toString()})(${JSON.stringify({ gameId: GAME_ID, user: USER, body })});`;
const indexPath = join(app, "public", "index.html");
const index = readFileSync(indexPath, "utf8");
writeFileSync(join(app, "public", "ios-review-smoke.js"), script);
writeFileSync(indexPath, index.replace("<head>", '<head><script src="/ios-review-smoke.js"></script>'));

// This is injected into the Simulator copy only, before the normal Vite entry.
function runReview({ gameId, user, body }: { gameId: string; user: typeof USER; body: unknown }) {
  const bridge = (window as unknown as { Capacitor: {
    nativePromise(plugin: string, method: string, options: Record<string, unknown>): Promise<unknown>;
  } }).Capacitor;
  const send = bridge.nativePromise.bind(bridge);
  const reopened = sessionStorage.getItem("gostone-ios-review-reopened") === "1";
  let finished = false;
  const { fail } = {
    fail(message: unknown) {
      if (finished) return;
      finished = true;
      console.error("GOSTONE_IOS_REVIEW_FAILED", message instanceof Error ? message.message : String(message));
    },
  };
  window.addEventListener("error", event => fail(event.message));
  window.addEventListener("unhandledrejection", event => fail(event.reason));
  history.replaceState(null, "", `/review/${gameId}`);
  let actualAnalysis = false;
  bridge.nativePromise = async (plugin, method, options) => {
    if (plugin === "CapacitorHttp" && method === "request") {
      const path = new URL(String(options.url)).pathname;
      const data = path === "/api/auth/session" ? { ok: true, user }
        : path === `/api/games/${gameId}` ? body
        : { ok: true, actor: user.playerKey, rating: null };
      if (path.endsWith("/analysis")) fail("The app called server KataGo.");
      return { status: 200, headers: { "content-type": "application/json" }, data };
    }
    if (plugin !== "GoStoneKataGo" || method !== "analyze") return send(plugin, method, options);
    if (reopened) fail("The reopened review did not use the cached result.");
    try {
      const result = await send(plugin, method, options) as { turns: { moveInfos: unknown[] }[] };
      if (result.turns.length !== 3 || !result.turns[0].moveInfos.length) {
        fail("Native KataGo did not return the full review and a candidate move.");
      }
      actualAnalysis = true;
      return result;
    } catch (error) {
      fail(error);
      throw error;
    }
  };

  const test = setInterval(() => {
    if (finished || (!reopened && !actualAnalysis)) return;
    const moves = document.querySelectorAll("[data-review-player] nav button");
    if (moves.length !== 2) return;
    if (reopened) {
      finished = true;
      clearInterval(test);
      console.log("GOSTONE_IOS_REVIEW_PASSED");
      return;
    }
    // Confirm the final result is committed before reloading the WebView.
    const database = indexedDB.open("gostone-mobile-analysis-v1", 1);
    database.onsuccess = () => {
      const db = database.result;
      if (!db.objectStoreNames.contains("analyses")) { db.close(); return; }
      const request = db.transaction("analyses").objectStore("analyses").getAll();
      request.onsuccess = () => {
        db.close();
        if (finished || !request.result.some(entry => entry.result.moves.length === 2)) return;
        finished = true;
        sessionStorage.setItem("gostone-ios-review-reopened", "1");
        window.location.reload();
      };
    };
  }, 400);
  setTimeout(() => fail(document.body?.innerText.slice(0, 400) || "Review timed out."), 110_000);
}
