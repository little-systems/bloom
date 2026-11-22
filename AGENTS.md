# AGENTS.md

Windows-only Tauri v2 app: Rust backend + React 19/TypeScript frontend. Replaces the native Windows taskbar (dock) and adds a notch/island UI. Bun is the package manager. CI runs on `windows-latest`.

## Commands

Run from the repo root unless noted. Bun 1.4.0, Rust 1.95.0 (pinned in `rust-toolchain.toml`).

- `bun install` — deps (CI uses `bun install --frozen-lockfile`; never create a root `package-lock.json`)
- `bun run tauri dev` — full dev loop. Vite is on strict port 1420; do not start `bun run dev` separately
- `bun run build` — `tsc && vite build`; this is the frontend typecheck. `strict` + `noUnusedLocals`/`noUnusedParameters` fail the build. There is no root lint or general frontend test script
- `bun run i18n:check` — validates `src/i18n/locales/*.json` and every literal `t("...")` key used in `src/`. Missing translations are warnings with a coverage report (English fallback); invalid keys/placeholders/empty values fail
- `bun run i18n:reference` — regenerate `docs/TRANSLATION_REFERENCE.md` after changing English messages; commit the generated file. CI checks it with `bun run i18n:reference --check`
- `bun run i18n:test` — localization fallback, interpolation, plural, and catalog validation tests; runs in CI
- `cargo fmt --check`, `cargo check --locked`, `cargo clippy --locked --all-targets -- -D warnings`, and `cargo test --locked` in `src-tauri` — CI's Rust gates; warnings fail the build
- `cargo test --locked` in `src-tauri` — pure-function unit tests. Runs fast on Windows and runs in CI
- `bun run bump <x.y.z>` — bumps `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` together
- `bun run release <x.y.z>` — bump + commit + tag + push, must be on `main`. The release workflow fails unless all four version files match the tag. Before/after releasing, follow `RELEASE_CHECKLIST.md` (updater manifest verification, N‑1 install smoke test)
- `website/` is a separate static site: use `npm install` / `npm run dev` there. Root scripts and CI do not build it

## Architecture

- Four webview windows, each a separate Vite/HTML entry: `main` = notch (`index.html` → `src/main.tsx` → `src/App.tsx`), `dock` (`dock.html` → `src/Dock.tsx`), `overlay` (`overlay.html` → `src/Overlay.tsx`), `settings` (`settings.html` → `src/Settings.tsx`). Adding or renaming a window means editing `src-tauri/tauri.conf.json`, `vite.config.ts` inputs, the HTML file, and `src-tauri/capabilities/default.json`
- Rust entrypoint is `src-tauri/src/main.rs`; `lib.rs` is an empty stub. Every `#[tauri::command]` must be registered in the `generate_handler!` list in `main.rs`
- `commands.rs` = IPC surface; `services.rs` = long-lived Win32 hooks/workers (keyboard hook, thumbnail capture, audio visualizer, AppBar registration); `utils.rs` = settings cache and file IO; `state.rs`/`types.rs` = shared statics/types
- Backend→frontend events use `app.emit`: `settings-changed`, `settings-external-changed`, `media-update`, `volume-change`, `brightness-change`, `dock-overlap`, `notch-overlap`, `windows-changed`, `update-available`, `auto-update-status`. Listen via `@tauri-apps/api/event`

## Settings

- Stored in `%APPDATA%/bloom/settings.json` as a flat object of `bloom-`-prefixed keys; all values are strings (`"true"`/`"false"` for booleans). `SETTINGS.md` documents every key
- UI write path: set `localStorage`, then `invoke("save_setting")` → backend caches it and emits `settings-changed`. External file edits are watched and emitted as `settings-external-changed`
- `src/hooks/useSettingsSync.ts` is the single sync hook for both events and normalizes string booleans/numbers
- The CSP in `tauri.conf.json` allow-lists network origins (weather APIs only); add new origins there. New Tauri plugins also need permissions in `capabilities/default.json`

## Localization

- Every feature or fix that adds or changes app-facing text must include the English entries in `src/i18n/locales/en.json` and use the helpers in `src/i18n`. This includes settings labels/descriptions, menus, onboarding, dialogs, notices, tooltips, placeholders, and accessibility labels. Do not hardcode new English UI text. Logs, internal identifiers, and names/content supplied by Windows or the user are not translations. `website/` is separate from the app catalogs.
- Keep standard i18next JSON v4: nested message keys, `{{name}}` placeholders, and plural keys such as `message_one` / `message_other`. Use `t("semantic.key", { name })` or `tCount("semantic.message", count)`. Translate complete messages rather than concatenated sentence fragments. Do not introduce a custom catalog format or plural/interpolation engine.
- English is the complete source of truth. Other language files may be partial; missing or invalid messages must safely fall back to English, including plurals. Do not require every language to be updated for a new feature, copy untranslated English into target catalogs, or generate unreviewed translations to fill coverage. When English meaning changes, use a new semantic key or explicitly request review of existing translations.
- Components that render localized text must call `useTranslation()` to update on language changes. Include the locale in memo dependencies when caching localized output. Use stable identifiers for program behavior, never displayed/translated labels. Keep language persistence and cross-window updates on the existing settings sync path.
- Native tray messages use the same bundled catalogs through `src-tauri/src/i18n.rs`. When adding a language, register it in `src/i18n/runtime.ts` and the native catalog list; see `TRANSLATING.md` for the workflow and layout limitations.
- After changing English, run `bun run i18n:reference` and include its output. Before finishing localization-related work, run `bun run i18n:check`, `bun run i18n:reference --check`, `bun run i18n:test`, and `bun run build`, plus appropriate Rust gates for native changes. Review dynamic translation keys manually; literal-key checks do not establish complete UI coverage.
- Contributor instructions live in `TRANSLATING.md`. Issue contributors use the generated English phrase reference; browser contributors use GitHub's normal fork-and-PR flow. Keep these instructions and the translation issue form aligned with the implementation.

## Gotchas

- The app hides the native Windows taskbar and registers AppBars while running. Any new exit/restart path must restore the taskbar and unregister AppBars, like the tray menu in `main.rs` does. A marker file restores it after a crash
- The `windows` crate is pinned to 0.61 with an explicit feature list in `Cargo.toml`; add features there when using new Win32 APIs
- Commits follow conventional commits (`feat:`, `fix:`); release notes are generated from them and commits touching only `website/*`, `.github/*`, or `*.md` are filtered out
