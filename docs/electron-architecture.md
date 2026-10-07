# Build the app foundation for {{APP_NAME}}

Set up a new macOS desktop app in this empty folder. Build only the foundation: the shell, the typed IPC contract, the window, the UI layer, secrets, tests and packaging. Prove every layer with one **tracer bullet**: a single setting and a single secret that travel renderer → preload → main → disk and back, end to end.

Fill in before starting:
- `{{APP_NAME}}`: product name, also the `.app` name
- `{{APP_ID}}`: reverse-DNS bundle id, e.g. `dev.you.app`
- `{{SIGNING_IDENTITY}}`: an Apple Development certificate name, from `security find-identity -v -p codesigning`

## Stack

| Layer | Technology |
|---|---|
| App shell | Electron 44, electron-vite 5 (Vite 7), `@vitejs/plugin-react` |
| Language | TypeScript 7, strict |
| UI | React 19, plain CSS with design tokens, fonts bundled as woff2 |
| Rich text (add when a screen edits or renders Markdown) | TipTap 3 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown`), react-markdown 10 |
| Window look | transparent `BrowserWindow` + an Objective-C++ N-API addon for background blur |
| Secrets | Electron `safeStorage` |
| Tests | Vitest 5, in-source |
| Packaging | electron-builder 26, node-gyp |

Electron carries its own Node (24 in Electron 44), so users install nothing.

## Layout

```
src/
  shared/api.ts        # the IPC contract: single source of truth
  main/index.ts        # owns all state and side effects
  main/ipc.ts
  main/settings.ts     # settings.json + safeStorage keys
  main/blur.ts
  preload/index.ts
  renderer/index.html
  renderer/src/{main.tsx, App.tsx, hooks.ts, env.d.ts, css.d.ts}
  renderer/src/styles/{tokens.css, fonts/*.woff2}
native/blur/{binding.gyp, blur.mm}
scripts/build-native.sh
build/{entitlements.mac.plist, icon.icns}
electron.vite.config.ts · vitest.config.ts · electron-builder.yml
tsconfig.json · tsconfig.node.json · tsconfig.web.json
```

## Steps

Work in order. Each step ends on its **done when** line; meet it before starting the next.

### 1. Toolchain

- `package.json`: `"main": "out/main/index.js"` and scripts:
  - `dev`: `npm run build:native && electron-vite dev`
  - `build`: `electron-vite build`
  - `test`: `vitest run`
  - `typecheck`: `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`
  - `build:native`: `bash scripts/build-native.sh`
  - `package`: `npm run build:native && electron-vite build && electron-builder --mac --dir`
- Two tsconfigs, both `strict`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `noEmit`:
  - `tsconfig.node.json`: includes `src/main`, `src/preload`, `src/shared` and both config files; `types: ["node", "vitest/importMeta"]`.
  - `tsconfig.web.json`: includes `src/renderer/src` and `src/shared`; `jsx: react-jsx`; `lib: ["ES2022", "DOM", "DOM.Iterable"]`; `types: ["vitest/importMeta"]`.
  - `tsconfig.json` holds only references to the two.
- `electron.vite.config.ts`: in **each** of `main`, `preload` and `renderer`, set `define: { 'import.meta.vitest': 'undefined' }` so in-source tests are stripped from builds. The renderer gets the React plugin and one `rollupOptions.input` entry per HTML page.
- `vitest.config.ts`: `includeSource: ['src/**/*.{ts,tsx}']`, `environment: 'node'`.

Done when: `npm run typecheck` exits 0 on the skeleton.

### 2. The IPC contract

`src/shared/api.ts` is the single source of truth for every call between the window and main:

```ts
export interface Settings { theme: 'system' | 'light' | 'dark'; hasApiKey: boolean }
export type SettingsPatch = Partial<Omit<Settings, 'hasApiKey'>>

export interface Api {
  getSettings(): Promise<Settings>
  saveSettings(patch: SettingsPatch): Promise<Settings>
  saveApiKey(key: string): Promise<void>
  removeApiKey(): Promise<void>
  onSettingsChanged(cb: () => void): () => void // returns unsubscribe
}

export const API_EVENTS = { onSettingsChanged: 'settingsChanged' } as const
export type ApiMethod = Exclude<keyof Api, keyof typeof API_EVENTS>
export const API_METHODS = ['getSettings', 'saveSettings', 'saveApiKey', 'removeApiKey'] as const satisfies readonly ApiMethod[]

// Fails to compile if a method is added to Api but not to API_METHODS.
type Missing = Exclude<ApiMethod, (typeof API_METHODS)[number]>
export const _allMethodsListed: Missing extends never ? true : Missing = true
```

- The preload loops over `API_METHODS` into `ipcRenderer.invoke('api:<name>', ...args)`, and over `API_EVENTS` into `ipcRenderer.on('evt:<channel>')` with a returned unsubscribe. It exposes the result as `window.api` through `contextBridge`.
- `main/ipc.ts`: `registerIpc(handlers: { [K in ApiMethod]: Api[K] })` loops over the same list into `ipcMain.handle('api:<name>')`.
- Main pushes events to every window with `webContents.send('evt:<channel>', payload)`.
- `renderer/src/env.d.ts` declares `window.api: Api` on `Window`.

A new capability later is one entry in `Api`, one in `API_METHODS` or `API_EVENTS`, and one handler.

Done when: deleting `'removeApiKey'` from `API_METHODS` makes `npm run typecheck` fail, and restoring it makes it pass.

### 3. Main process and window

- Main owns all state and side effects; the renderer renders and asks.
- `createMainWindow()`: `titleBarStyle: 'hiddenInset'`, `transparent: true`, `backgroundColor: '#00000000'`, `show: false`, preload set. Show it on `ready-to-show`, plus a 3 s fallback timer that shows it anyway, so a wedged renderer can't leave it hidden.
- Load `process.env.ELECTRON_RENDERER_URL` in dev, the built HTML file otherwise.
- The renderer names things by id; main turns ids into paths. Any renderer string that reaches a file name is checked against a known list in main first.

Done when: `npm run dev` opens a transparent window with inset traffic lights showing the React root.

### 4. UI layer

- React 19 under `StrictMode`. State lives in main: each `useX` hook loads through `window.api`, subscribes to the matching `onXChanged` event, and loads again when it fires. Example: `useSettings()` calls `getSettings()` and reloads on `onSettingsChanged`.
- Plain CSS. `styles/tokens.css` is the one place colors, type, spacing, radii and motion are defined, as `--app-*` custom properties, and components use only those tokens. Include `--app-window-tint` (an rgba over the blurred desktop) as the root background, so the blur shows through.
- Fonts are bundled as woff2 with `@font-face` in `tokens.css` (meetnotes pairs Inter for UI with Newsreader for display), so the app renders fully offline. Add `css.d.ts` declaring `*.css` modules.
- Tracer UI: one screen with a theme select bound to `saveSettings`, and an API key field with Save and Remove that shows whether a key is stored.

Done when: changing the theme writes `settings.json` in `app.getPath('userData')`, and the screen updates through `onSettingsChanged`.

### 5. Window blur addon

- `native/blur/blur.mm`: an N-API module exporting `setBlur(handle: Buffer, radius: number): number`. The handle comes from `BrowserWindow.getNativeWindowHandle()`, a buffer holding an `NSView *`. It calls the private SkyLight API that iTerm2 and Warp use:
  ```objc
  typedef int CGSConnectionID;
  extern "C" CGSConnectionID CGSMainConnectionID(void);
  extern "C" int CGSSetWindowBackgroundBlurRadius(CGSConnectionID cid, NSInteger wid, int radius);
  // wid = view.window.windowNumber; returns 0 on success
  ```
- `binding.gyp`: `sources: ["blur.mm"]`; `xcode_settings`: `OTHER_LDFLAGS: ["-framework Cocoa", "-F/System/Library/PrivateFrameworks", "-framework SkyLight"]`, `CLANG_ENABLE_OBJC_ARC: "YES"`, `MACOSX_DEPLOYMENT_TARGET: "14.2"`.
- `scripts/build-native.sh` builds it against **Electron's** headers: `node-gyp rebuild --target=$(node -p "require('electron/package.json').version") --arch=arm64 --dist-url=https://electronjs.org/headers`.
- `main/blur.ts` loads it with `process.dlopen` (the bundler passes that through), from `process.resourcesPath/blur.node` when packaged and `native/blur/build/Release/blur.node` in dev. A missing or failing addon is logged, and the window stays usable without blur. Clamp the radius to 0–40 and apply it on `did-finish-load` and again whenever the appearance settings are saved, so a blur slider updates live.
- The radius is the user's blur value while the window tint is translucent, and 0 when opacity is 100%: a solid window has nothing to blur, and the slider's help text should say so.
- Do not substitute Electron's own options for the addon; they look close but are not the same thing:
  - `BrowserWindow.setVibrancy()` / `vibrancy:` wraps an `NSVisualEffectView`. It is a fixed system material: no radius, its own tint, and a different look from iTerm2 and Warp. A 0–40 px slider wired to it becomes an on/off switch.
  - CSS `backdrop-filter` on the page root blurs only what Chromium itself composites. In a transparent window the desktop is not part of that backdrop, so it does nothing.
- Add `native/blur/build/` to `.gitignore`; only `binding.gyp` and `blur.mm` are source.

Done when: in `npm run dev` the desktop behind the window is blurred and the blur changes as the slider moves, and with `blur.node` renamed away the window still opens and works, unblurred. Check it with a full-screen `screencapture`: a window-only capture (`screencapture -l <id>`) renders the window without what is behind it, so it can never show the blur.

### 6. Secrets

- `safeStorage.encryptString` into `userData/<name>-key.bin`; call `decryptString` only where the secret is used. Import `safeStorage` lazily inside those functions so the module stays testable in plain Node.
- Settings report a key's presence by checking that its file exists, so reading settings never asks the Keychain to decrypt.
- The renderer only ever sees `hasApiKey`.

Done when: saving a key creates an unreadable `*-key.bin`, `getSettings()` returns `hasApiKey: true`, and Remove deletes the file.

### 7. Tests

- Tests sit beside the code in `if (import.meta.vitest) { const { it, expect } = import.meta.vitest; … }` blocks, each named by the behavior it verifies, in plain language.
- Pull logic into pure functions (settings normalization, patch merging) and test those in plain Node.

Done when: `npm test` passes with at least one in-source test each in `main`, `shared` and `renderer`, and after `npm run build`, `grep -r "import.meta.vitest" out/` finds nothing.

### 8. Packaging

`electron-builder.yml`:
- `appId: {{APP_ID}}`, `productName: {{APP_NAME}}`, `files: [out/**]`, `directories.output: dist`.
- `mac.target: dir` (add `dmg` when shipping to others), `mac.icon: build/icon.icns`.
- `mac.identity: '{{SIGNING_IDENTITY}}'`. A real certificate keeps the app's identity stable across rebuilds, so macOS keeps its privacy permissions. An ad-hoc signature (`-`) looks like a new app on every build.
- `entitlements` and `entitlementsInherit`: `build/entitlements.mac.plist` with `com.apple.security.cs.allow-jit`, `com.apple.security.cs.allow-unsigned-executable-memory` and `com.apple.security.cs.disable-library-validation`, which Electron needs under the hardened runtime. For each device permission the app uses, add its entitlement (e.g. `com.apple.security.device.audio-input`) **and** the matching usage string in `mac.extendInfo` (e.g. `NSMicrophoneUsageDescription`). The hardened runtime denies a missing entitlement silently: no prompt, no entry in System Settings.
- `extraResources`: `native/blur/build/Release/blur.node` → `blur.node`.
- Every npm package with a native addon goes under `asarUnpack`, because `dlopen` needs a real file on disk.

Done when: `npm run package` produces `dist/mac-arm64/{{APP_NAME}}.app`, `codesign -dv` on it names `{{SIGNING_IDENTITY}}`, and the packaged app opens blurred with the tracer bullet working.

## Later branches

- **utilityProcess worker** (heavy compute off the main process): add it as a second `main` entry in `rollupOptions.input` and set `output.chunkFileNames: '[name]-[hash].js'`, so shared chunks sit next to `index.js` where `utilityProcess.fork(join(__dirname, 'worker.js'))` finds them.
- **Swift helper** (a macOS API Node can't reach): a single-file CLI built in `build-native.sh` with `swiftc -O -target arm64-apple-macos<version>`, ad-hoc signed with `codesign --force --sign -`, shipped through `extraResources`, and driven with JSON lines over stdin/stdout. Main restarts it on exit with a backoff that doubles up to 30 s.

## Finish

Report every step's **done when** with the command you ran and its output. List anything unmet as not done, with the reason.
