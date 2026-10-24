import type { Locale } from "./config";
import { getDictionary } from "./dictionary";
import { localizePathname } from "./routing";
import { THEME_BOOTSTRAP } from "@/lib/theme";

export function localizedNotFoundResponse(locale: Locale): Response {
  const dictionary = getDictionary(locale);
  const copy = dictionary.notFound;
  const metadata = dictionary.metadata.notFound;
  return new Response(
    `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${metadata.title} · GoStone</title>
  <meta name="description" content="${metadata.description}">
  <script>${THEME_BOOTSTRAP}</script>
  <style>
    :root{color-scheme:light;font-family:Arial,sans-serif;background:#f5f2eb;color:#171816;--muted:#575b54;--accent:#315f4e;--focus:#171816}
    :root[data-theme="dark"]{color-scheme:dark;background:#262421;color:#f4f3f1;--muted:#b8b5b2;--accent:#477563;--focus:#fff}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
    main{max-width:640px;text-align:center}.kicker{color:var(--muted);font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
    h1{font-size:clamp(40px,8vw,68px);letter-spacing:-.05em;line-height:1;margin:16px 0}
    p{color:var(--muted);line-height:1.6;margin:0 auto 26px;max-width:520px}
    a{background:var(--accent);border-radius:7px;color:#fff;display:inline-block;font-weight:800;padding:13px 18px;text-decoration:none}
    a:focus-visible{outline:3px solid var(--focus);outline-offset:4px}
  </style>
</head>
<body>
  <main>
    <span class="kicker">${copy.kicker}</span>
    <h1>${copy.title}</h1>
    <p>${copy.description}</p>
    <a href="${localizePathname("/", locale)}">${copy.action}</a>
  </main>
</body>
</html>`,
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Language": locale,
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
