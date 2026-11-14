# GoStone iPhone home preview

[Light](GoStone-light.png) · [Dark](GoStone-dark.png) · [Side by side](GoStone-Vergleich-Light-Dark.png)

One signed-in layout in two appearances. The Daily Puzzle tile shows a corner from the first position in the GoStone daily rotation. Continue Learning shows the sample lesson count and the corresponding completion bar. Both appearances use the same hierarchy, dock and tab order.

Run `npx vite --config vite.home-preview.config.mts` to open the standalone preview. Use the Light and Dark buttons above the phone. The initial appearance follows the system unless a `?theme=light` or `?theme=dark` parameter is specified. The `capture` parameter hides the appearance switch for screenshots.

The signed-in preview uses fictitious names and sample data. The puzzle tile opens the live puzzle hub. Game rows open sample details. Other links point to the corresponding GoStone website routes.

Verified in Chromium and WebKit at 402 × 874, 360 × 740 and 320 × 640. The screenshots come from a browser on Windows. iPhone system chrome is simulated.
