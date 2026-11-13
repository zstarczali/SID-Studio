# VA SID Studio 1.8.1

<p align="center">
  <img src="www/assets/logo-about.png" alt="VA SID Studio logo">
</p>

<!-- badges:start -->
<p align="center">
  <a href="https://www.c64va.pro/"><img src="https://img.shields.io/badge/website-c64va.pro-e05d44?style=flat" alt="Website"></a>
  <a href="https://github.com/zstarczali/SID-Studio/blob/main/package.json"><img src="https://img.shields.io/github/package-json/v/zstarczali/SID-Studio/main?label=version&color=4c1" alt="Version"></a>
  <a href="https://github.com/zstarczali/SID-Studio/actions/workflows/build-installers.yml"><img src="https://img.shields.io/github/actions/workflow/status/zstarczali/SID-Studio/build-installers.yml?branch=main&label=build" alt="Build"></a>
  <a href="https://github.com/zstarczali/SID-Studio/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-GPLv3-blue" alt="License: GPLv3"></a>
  <a href="https://www.c64va.pro/register/donate.php"><img src="https://img.shields.io/badge/donate-PayPal-00457C?logo=paypal&logoColor=white" alt="Donate"></a>
</p>
<p align="center">
  <a href="https://v2.tauri.app/"><img src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white" alt="Tauri 2"></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-backend-B7410E?logo=rust&logoColor=white" alt="Rust"></a>
  <a href="https://github.com/binaryfields/resid-rs"><img src="https://img.shields.io/badge/SID-reSID%20%7C%20VA%20SID%20Core-6c5eb5" alt="SID engines"></a>
  <a href="https://www.c64va.pro/"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-555" alt="Platforms"></a>
  <a href="https://github.com/zstarczali/SID-Studio/commits/main"><img src="https://img.shields.io/github/last-commit/zstarczali/SID-Studio/main" alt="Last commit"></a>
  <a href="https://github.com/zstarczali/SID-Studio/graphs/commit-activity"><img src="https://img.shields.io/github/commit-activity/m/zstarczali/SID-Studio" alt="Commit activity"></a>
  <a href="https://github.com/zstarczali/SID-Studio/issues"><img src="https://img.shields.io/github/issues/zstarczali/SID-Studio" alt="Issues"></a>
  <a href="https://github.com/zstarczali/SID-Studio/stargazers"><img src="https://img.shields.io/github/stars/zstarczali/SID-Studio?style=flat" alt="Stars"></a>
</p>
<p align="center">
  <a href="https://github.com/zstarczali/SID-Studio#readme"><img src="https://img.shields.io/badge/English-ddd" alt="English"></a>
  <a href="https://github.com/zstarczali/SID-Studio#readme"><img src="https://img.shields.io/badge/Magyar-ddd" alt="Magyar"></a>
  <a href="https://github.com/zstarczali/SID-Studio#readme"><img src="https://img.shields.io/badge/Deutsch-ddd" alt="Deutsch"></a>
  <a href="https://github.com/zstarczali/SID-Studio#readme"><img src="https://img.shields.io/badge/Espa%C3%B1ol-ddd" alt="Español"></a>
  <a href="https://github.com/zstarczali/SID-Studio#readme"><img src="https://img.shields.io/badge/Nederlands-ddd" alt="Nederlands"></a>
  <a href="https://github.com/zstarczali/SID-Studio#readme"><img src="https://img.shields.io/badge/Polski-ddd" alt="Polski"></a>
  <a href="https://github.com/zstarczali/SID-Studio#readme"><img src="https://img.shields.io/badge/Italiano-ddd" alt="Italiano"></a>
  <a href="https://www.c64va.pro/"><img src="https://img.shields.io/badge/sibling-C64%20Visual%20Assembler-8a2be2" alt="C64 Visual Assembler"></a>
</p>
<!-- badges:end -->

A Commodore 64 SID player and tracker as a standalone desktop app (Tauri 2, vanilla JS, Rust), extracted from
[C64 Visual Assembler](https://www.c64va.pro/).

- SID Player: playlists, High Voltage SID Collection, spectrum analyzer, 2SID / 3SID tunes (stereo on both SID engines)
- Amiga and tracker modules in the SID Player: the Modland collection (about 177,000 playable modules), dropped `.mod` / `.xm` / `.s3m` / `.it` / `.med` … files, played with [libopenmpt](https://lib.openmpt.org/) (WebAssembly, `www/lib/libopenmpt`)
- Channel curves: per-channel level history and large note names for SID and tracker modules, including six voices with two SID chips; shared by the player and editor, with saved visibility, size and position
- Spectrum views: mixed audio, separate estimated SID voice spectra, or module channel spectra from each channel's note and VU level; draggable, resizable analyzer windows
- SID Editor: 3-voice tracker (6 voices with a second SID at a selectable address), instruments, wave/arpeggio tables with gate-off steps, effects (vibrato, slides, note cut, speed, legato), piano roll, per-voice spectrum, virtual keyboard, MIDI, recording
- Playback and preview on reSID ([resid-rs](https://github.com/binaryfields/resid-rs), the default) or VA SID Core, both in Rust with a cycle-exact 6510 / CIA / VIC-II core, 6581 and 8580 (with an optional 8580 digi boost for `$D418` samples)
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
