# Home and account stone artwork

`components/home/StoneArtwork.tsx` shares the light and dark photographs between
the homepage, login and registration pages. The saved website theme selects the
visible image in CSS before hydration. Keep shadows and highlights natural; do
not invert the photograph or use screen blending. Account artwork fades at all
four edges on the image itself so letterboxing cannot reveal a rectangular edge.

The native home and account screens use CSS stones, with a restrained graphite
gradient in dark mode. Authentication forms are shared with the website.

## Dark photograph provenance

- Source: `public/images/gostone-hero-stone.webp`.
- Output: `public/images/gostone-hero-stone-dark.webp` (1536 × 984, 19 KB).
- Created using the built-in Imagegen tool, then resized and encoded as WebP.
- Final edit prompt:

> Use case: lighting-weather. Edit target: the supplied GoStone hero photograph. Create its dark-mode counterpart for an elegant Go game website. Preserve the exact composition, camera angle, single black flattened Go stone, scale and position (stone centered horizontally around 56% height), and concentric water ripples. Change only illumination and environment palette: very dark charcoal water and background matching #111310 at the outer edges, a naturally BLACK graphite Go stone with softly lit, restrained grey highlights on its upper left surface, subtle dark muted grey-green ripples and natural contact shadow. The stone must be clearly readable and tactile, with gentle directional studio light, never luminous or white. Outer quarter of image should be almost uniform #111310 to blend seamlessly into a dark webpage. Keep the existing landscape aspect ratio. No glow, no underlighting, no white reflection beneath the stone, no neon, no additional objects, no text, no border, no vignette frame.
