# VA SID Studio

A Commodore 64 SID player and tracker as a standalone desktop app (Tauri 2, vanilla JS, Rust), extracted from
[C64 Visual Assembler](https://www.c64va.pro/).

- SID Player: playlists, High Voltage SID Collection, spectrum analyzer
- SID Editor: 3-voice tracker, instruments, wave/arpeggio tables, effects, piano roll, virtual keyboard, MIDI, recording
- Preview on WebSID or VA SID Core (Rust, cycle-exact 6510 / CIA / VIC-II timing, 6581 and 8580)
- Import: GoatTracker `.sng`, `.sid`; export: `.bin`, 6502 assembly, UltimateBasic, `.sid` (PSID)

The app is an empty workspace: the SID Player, the SID Editor and the other windows float in it.
The edited tune is kept in the app's local storage between runs; `Save .bin` writes it to a file.

```
npm install
npm run dev     # tauri dev
npm run build   # installers
npm test        # JS engine tests; Rust: cargo test in src-tauri
```

The `Build installers` GitHub Actions workflow builds the Windows and macOS (x64, ARM64) and the Linux (x64)
installers; start it from the Actions tab or push a `v*` tag.

`www/sid-editor.js` is the SID code of the Visual Assembler's `www/app.js`. The player is assembled by the
[VMA](https://github.com/zstarczali/VMA) crate. The C64 emulation in `src-tauri/src/c64` and `mos6510.rs` is a
port of VICE (GPLv2+). License: GPLv3, see `LICENSE`.
