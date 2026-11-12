# VA SID Studio 1.7.2

<p align="center">
  <img src="www/assets/logo-about.png" alt="VA SID Studio logo">
</p>

A Commodore 64 SID player and tracker as a standalone desktop app (Tauri 2, vanilla JS, Rust), extracted from
[C64 Visual Assembler](https://www.c64va.pro/).

- SID Player: playlists, High Voltage SID Collection, spectrum analyzer, 2SID / 3SID tunes (stereo on both SID engines)
- Amiga and tracker modules in the SID Player: the Modland collection (about 177,000 playable modules), dropped `.mod` / `.xm` / `.s3m` / `.it` / `.med` … files, played with [libopenmpt](https://lib.openmpt.org/) (WebAssembly, `www/lib/libopenmpt`)
- Channel curves: per-channel level history and large note names for SID and tracker modules, including six voices with two SID chips; shared by the player and editor, with saved visibility, size and position
- Spectrum views: mixed audio, separate estimated SID voice spectra, or module channel spectra from each channel's note and VU level; draggable, resizable analyzer windows
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
installers and uploads the matching SID manual; start it from the Actions tab or push a `v*` tag.

The manual **Publish** workflow takes a successful **Build installers** run ID (the number in its
`/actions/runs/…` URL), extracts its `va-sid-studio-*` artifacts, and uploads the installers and
`VA SID Studio Manual.pdf` directly to `/www/downloads/SIDS/` on `ftpx.forpsi.com`, using explicit
FTPS with certificate verification. Configure the repository Actions secret `FTP_PASSWORD` for
the `www.c64va.pro` FTP account before running it. The workflow replaces files with matching
names, then removes older SID Studio installers only after every upload and size check succeeds.
The uploaded release, newer releases, the manual and unrelated files are retained.
Failed uploads never trigger cleanup. If an older build has no manual artifact, Publish takes the PDF
from that build's exact Git commit instead; rebuilding the installers is not required. It fails
if no installers are found or neither source supplies the manual.
A manually dispatched workflow must exist on the default branch to appear in the Actions UI;
select `development` in **Use workflow from** when publishing from that branch.

The macOS app is not signed with an Apple Developer ID or notarized (ad-hoc signature only), so macOS quarantines
the download and may refuse to open it. After copying it to Applications, run once:

```
xattr -cr "/Applications/VA SID Studio.app"
```

`www/sid-editor.js` is the SID code of the Visual Assembler's `www/app.js`. The player is assembled by the
[VMA](https://github.com/zstarczali/VMA) crate. The C64 emulation in `src-tauri/src/c64` and `mos6510.rs` is a
port of VICE (GPLv2+). License: GPLv3, see `LICENSE`.
