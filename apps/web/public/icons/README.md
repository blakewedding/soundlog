# Icon assets — PLACEHOLDER

Everything in this directory is a **placeholder**, generated from the Groove
glyph by `apps/web/scripts/generate-icons.mjs`. The files are correct as files —
right dimensions, opaque, design-system colours, mark inside the maskable safe
zone — but they are not finished icon design. See the README's **Phase 7** entry
for what is outstanding.

## Replacing them with final artwork

Drop-in by design. Overwrite these exact filenames at these exact dimensions and
**no code changes are needed** — `index.html` and `site.webmanifest` reference
them by fixed name, and nothing imports them from JavaScript.

| File | Size | Used by |
|---|---|---|
| `favicon.svg` | vector | Modern browsers (preferred; scales to any tab density) |
| `favicon-32.png` | 32×32 | Browsers without SVG favicon support |
| `favicon-16.png` | 16×16 | Same, small density |
| `apple-touch-icon.png` | 180×180 | iOS home screen |
| `icon-192.png` | 192×192 | Web app manifest, Android home screen |
| `icon-512.png` | 512×512 | Web app manifest, splash / store listing |

Constraints the replacements must keep:

- **Square and opaque.** No baked-in rounding on the PNGs. Every platform
  applies its own mask; a pre-rounded icon gets rounded twice and shows pale
  corner wedges. Only `favicon.svg` carries a slight radius, because a tab
  favicon is drawn unmasked.
- **Maskable safe zone.** Keep all meaningful ink within a circle of radius 40%
  of the edge, centred. Android's adaptive icons crop aggressively.
- **No transparency in the PNGs.** iOS composites transparent pixels onto black
  and the mark loses its tile.

Once final artwork lands, delete `scripts/generate-icons.mjs` rather than
re-running it — it exists only to produce these placeholders.
