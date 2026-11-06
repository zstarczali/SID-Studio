# VA SID Studio

<img src="www/assets/logo-about.png" alt="VA SID Studio logo" width="300">

A Commodore 64 SID player and tracker as a standalone desktop app (Tauri 2, vanilla JS, Rust), extracted from
[C64 Visual Assembler](https://www.c64va.pro/).

- SID Player: playlists, High Voltage SID Collection, spectrum analyzer, 2SID / 3SID tunes (stereo on VA SID Core)
- Amiga and tracker modules in the SID Player: the Modland collection (about 177,000 playable modules), dropped `.mod` / `.xm` / `.s3m` / `.it` / `.med` … files, played with [libopenmpt](https://lib.openmpt.org/) (WebAssembly, `www/lib/libopenmpt`)
- SID Editor: 3-voice tracker (6 voices with a second SID at a selectable address), instruments, wave/arpeggio tables, effects, piano roll, per-voice spectrum, virtual keyboard, MIDI, recording
- Playback and preview on reSID ([resid-rs](https://github.com/binaryfields/resid-rs), the default) or VA SID Core, both in Rust with a cycle-exact 6510 / CIA / VIC-II core, 6581 and 8580
- Import: GoatTracker `.sng`, `.sid` (a 2SID tune as six voices); export: `.bin`, 6502 assembly, UltimateBasic, `.sid` (PSID)

The app is an empty workspace: the SID Player, the SID Editor and the other windows float in it.
The edited tune is kept in the app's local storage between runs; `Save .bin` writes it to a file.

User manual: [VA SID Studio Manual.md](VA%20SID%20Studio%20Manual.md) (PDF: `docs/VA SID Studio Manual.pdf`).

```
npm install
npm run dev     # tauri dev
npm run build   # installers
npm test        # JS engine tests; Rust: cargo test in src-tauri
```

The `Build installers` GitHub Actions workflow builds the Windows and macOS (x64, ARM64) and the Linux (x64)
installers; start it from the Actions tab or push a `v*` tag.

The macOS app is not signed with an Apple Developer ID or notarized (ad-hoc signature only), so macOS quarantines
the download and may refuse to open it. After copying it to Applications, run once:

```
xattr -cr "/Applications/VA SID Studio.app"
```

`www/sid-editor.js` is the SID code of the Visual Assembler's `www/app.js`. The player is assembled by the
[VMA](https://github.com/zstarczali/VMA) crate. The C64 emulation in `src-tauri/src/c64` and `mos6510.rs` is a
port of VICE (GPLv2+). License: GPLv3, see `LICENSE`.
