import { ImageResponse } from "next/og";
import type { Locale } from "./config";
import { getDictionary } from "./dictionary";

export const OPEN_GRAPH_IMAGE_SIZE = { width: 1200, height: 630 };

export function createOpenGraphImage(locale: Locale) {
  const dictionary = getDictionary(locale);
  const home = dictionary.home;
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#262421",
          color: "#f4f3f1",
          display: "flex",
          height: "100%",
          justifyContent: "space-between",
          padding: "78px 90px",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ alignItems: "center", display: "flex", gap: 18 }}>
            <div style={{ display: "flex", height: 54, position: "relative", width: 54 }}>
              <span style={{ background: "#111", borderRadius: "50%", height: 32, left: 0, position: "absolute", top: 0, width: 32 }} />
              <span style={{ background: "#f2f1ee", borderRadius: "50%", bottom: 0, height: 32, position: "absolute", right: 0, width: 32 }} />
            </div>
            <span style={{ fontSize: 62, fontWeight: 800, letterSpacing: "-3px" }}>GoStone</span>
          </div>
          <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: "-4px", lineHeight: 1.02, maxWidth: 720 }}>
            {home.title}
          </div>
          <div style={{ color: "#b8b5b2", display: "flex", fontSize: 28 }}>
            9×9 · 13×13 · 19×19 · {home.openGraphMatchmaking}
          </div>
        </div>
        <div
          style={{
            alignItems: "center",
            background: "#81b64c",
            borderRadius: 22,
            display: "flex",
            fontSize: 28,
            fontWeight: 700,
            justifyContent: "center",
            padding: "28px 36px",
          }}
        >
          {home.playOnline}
        </div>
      </div>
    ),
    OPEN_GRAPH_IMAGE_SIZE,
  );
}
