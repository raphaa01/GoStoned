# GoStone iPhone home preview

[Dark](GoStone-dark.png) · [Light](GoStone-light.png) · [Side by side](GoStone-Vergleich-Light-Dark.png)

The Tournaments tile features a faceted double-convex stone. Its 3D mesh is projected into SVG. Horizontal drags or arrow keys rotate it around its vertical axis, and the Tournaments link opens GoStone's tournament overview. The dark appearance uses an anthracite background, matte ink blue for Play and a muted blue learning surface. Light uses the same layout with a brighter neutral background.

Run `npx vite --config vite.home-preview.config.mts` to open the standalone preview. The Light and Dark buttons above the phone switch appearance. The initial theme follows the system unless a `?theme=light` or `?theme=dark` parameter is specified. Use `capture` to hide the switch for screenshots.

The signed-in preview uses fictitious names and sample data. Game rows open sample details. Other links point to the corresponding GoStone website routes. The screenshots come from a browser on Windows. iPhone system chrome is simulated.
