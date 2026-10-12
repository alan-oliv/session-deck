# Handoff: Session deck app icon

## Overview
This is the macOS application icon for **Session deck**, the Claude Code session manager. It's built from logo option **2a**: a stack of three cards (older sessions behind) with an original pixel character on the front card.

There are two variants:

| Id | Name | Use |
|---|---|---|
| **3a** | Dark tile | **Default.** Matches the app window (`#191a23`). |
| **3b** | Purple tile | Alternative with more contrast in the Dock (`#575bc7`). |

Pick one for the shipped `.icns`. The other can be offered as an alternate icon if the app supports switching icons.

## About the Design Files
The SVGs and PNGs in this bundle are **final production assets**, not mock-ups. `Session Deck Logo.dc.html` is a **design reference created in HTML**: a canvas that shows the icon at every size and on light and dark desktops. Don't ship it. Wire the assets into the app's build (Xcode asset catalog, `electron-builder`, Tauri `icons/`, etc.) using that environment's normal icon pipeline.

## Fidelity
**High fidelity.** The geometry and colours below are final. When regenerating sizes, rasterise from the SVG rather than redrawing.

---

## Icon specification

### Canvas and grid (macOS Big Sur+ template)
- **Canvas**: 1024 × 1024px, transparent.
- **Tile**: a rounded rectangle at `x=100, y=100`, **824 × 824px**, corner radius **185px**.
  - The radius is a simple rounded rect, close to Apple's continuous-corner squircle. If the toolchain offers Apple's squircle mask, use that at the same 824px size.
- **Tile shadow**: `feDropShadow dx=0 dy=12 stdDeviation=14`, black at 35% opacity. This sits in the 100px margin, which is the shadow area Apple's template allows for.
- **Tile edge**: a 2px inside stroke on the same rounded rect (inset 0.5px, radius 184.5).
  - 3a: `rgba(255,255,255,.08)`
  - 3b: `rgba(255,255,255,.16)`
- **Mark area**: the mark's 24 × 24-unit bounding box (units 4–28 of its 32-unit viewBox) is scaled to **560 × 560px** at `x=232, y=232`. That's **23.33px per unit**, centred both ways in the tile.

### Mark geometry (32-unit viewBox; all values in units)
| Layer | x | y | w | h | rx | 3a fill | 3b fill |
|---|---|---|---|---|---|---|---|
| Back card | 8 | 4 | 16 | 18 | 3 | `#2c2d42` | `rgba(255,255,255,.30)` |
| Middle card | 6 | 7 | 20 | 18 | 3 | `#444556` | `rgba(255,255,255,.55)` |
| Front card | 4 | 10 | 24 | 18 | 3.5 | `#575bc7` | `#ffffff` |

**Pixel character.** 2-unit pixels drawn with `shape-rendering: crispEdges`. Body colour: 3a `#ffffff`, 3b `#575bc7`.

| Part | x | y | w | h |
|---|---|---|---|---|
| Antenna | 15 | 13 | 2 | 2 |
| Head top | 11 | 15 | 10 | 2 |
| Body | 9 | 17 | 14 | 6 |
| Left foot | 11 | 23 | 2 | 2 |
| Right foot | 19 | 23 | 2 | 2 |

**Eyes**: two 2 × 2 squares at (13, 18) and (17, 18), in the front card's colour so they read as holes. 3a `#575bc7`, 3b `#ffffff`.

The character is an original design for Session deck: antenna, rounded head, two feet, no side arms. Keep it that way. Don't change it to resemble other products' mascots.

### Colours
| Token | Hex | Where |
|---|---|---|
| Sidebar / dark tile | `#191a23` | 3a tile |
| Brand purple | `#575bc7` | 3a front card, 3b tile, character (3b) |
| Grey 1 | `#2c2d42` | 3a back card |
| Grey 2 | `#444556` | 3a middle card |
| White | `#ffffff` | character (3a), front card (3b) |

All colours come from the Linear Design System (Dark) palette that the app uses.

### Small sizes
- At **32px and below**, the back cards and the 2-unit pixels land on fractional pixels.
- The supplied PNGs are rasterised straight from the SVG and still read clearly at 16px. If the 16px menu bar or Finder list view looks soft on a 1× display, hand-tune `icon_16x16.png` and `icon_32x32.png`:
  - snap the cards to whole pixels
  - drop the back card
  - keep the character at 1px per unit
- **Menu bar (template image)**: not included. If the app adds a menu-bar extra, make a single-colour template version: the front card outline with the character cut out, black on transparent, 18 × 18pt.

---

## Integration

### macOS `.icns`
The `SessionDeck-dark.iconset/` and `SessionDeck-purple.iconset/` folders use Apple's naming. Build each with:

```sh
iconutil -c icns SessionDeck-dark.iconset -o SessionDeck.icns
```

| File | Pixels |
|---|---|
| icon_16x16.png | 16 |
| icon_16x16@2x.png | 32 |
| icon_32x32.png | 32 |
| icon_32x32@2x.png | 64 |
| icon_128x128.png | 128 |
| icon_128x128@2x.png | 256 |
| icon_256x256.png | 256 |
| icon_256x256@2x.png | 512 |
| icon_512x512.png | 512 |
| icon_512x512@2x.png | 1024 |

### By stack
- **Xcode / SwiftUI**: drop the PNGs into `Assets.xcassets/AppIcon.appiconset` (macOS slots).
- **Electron (electron-builder)**: set `mac.icon` to `SessionDeck.icns`. Use the 1024px PNG for Linux and to generate a Windows `.ico` (`icon_512x512@2x.png` → `build/icon.png`).
- **Tauri**: run `tauri icon icon_512x512@2x.png` to generate every platform size into `src-tauri/icons/`.

### In-app uses of the mark
- `session-deck-mark.svg` is the bare 2a mark with no tile.
- Use it for the About window, the terminal "Opened by Session deck" line, and the end card in the promo video.
- Minimum size is 16px. Keep clear space of at least 4 units (an eighth of its size) around it.

## Interactions & Behavior
None. The icon is static. If an alternate-icon setting is added, it should switch between 3a and 3b with `NSApplication.applicationIconImage` (or the Electron/Tauri equivalent), saved in app settings.

## Assets
| File | Description |
|---|---|
| `session-deck-icon.svg` | 3a, dark tile, 1024 × 1024 master |
| `session-deck-icon-brand.svg` | 3b, purple tile, 1024 × 1024 master |
| `SessionDeck-dark.iconset/` | 3a PNGs at every macOS size |
| `SessionDeck-purple.iconset/` | 3b PNGs at every macOS size |
| `session-deck-mark.svg` | the 2a mark alone, 32 × 32 viewBox |

## Files
- `Session Deck Logo.dc.html`: the logo canvas. **App icon** (3a, 3b) is at the top, then round 2 (2a, 2b) and round 1. It needs `support.js` and the `_ds/` folder to open. Serve the folder over HTTP (`npx serve .`) to view it.
- `app-icon/`: the two SVG masters that the canvas references.
