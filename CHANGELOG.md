# Changelog

## 1.3.2 - 2026-11-02

- Undo and Redo in the SID Editor: two new buttons in the tracker toolbar, or Ctrl+Z and Ctrl+Y, up to 100 steps. A whole recording is one step.
- Tempo: the tracker's tempo field is now called Frames/row: a higher number is slower. BPM next to it shows the resulting tempo.
- Moving notes in the horizontal tracker: drag a note's body to move it in time and pitch. It keeps its length, instrument and effect, and stops a row short of the voice's next note.
- Note length in the horizontal tracker: a note's right end is easy to catch now, even on a one-row note (double arrow cursor, bright bar). It stops at the voice's next note, instead of deleting it.
- Connect MIDI: on Windows the web view no longer asks for permission in a dialog of its own.
- Loading a .bin: the tracker opens on the selected first song step; a tune whose song does not start with pattern 0 showed pattern 0 instead.
- SID Player Pause: it pauses every time now (a chunk rendered at that moment, or a note from the SID Editor, could switch the sound back on), and pressing it again continues.
- Stop in Play: All: the tracker returns to the pattern that was open before playback, instead of staying on the last one played.
- Poly record from MIDI: with **Poly record** on, the keys held while recording go to voices of their own, and a release writes a note-off.
- No click on reSID: neither before notes played live, nor on the first note of a tune that does not begin on the first row, with either the 6581 or the 8580.

## 1.3.1 - 2026-11-02

- macOS 26: the app icon fills the whole icon shape, with no light frame around it. It is an Icon Composer package (`src-tauri/icons/AppIcon.icon`), compiled to `Assets.car` at build time; building for macOS needs Xcode 26. Older macOS versions keep `icon.icns`.
- readme: what to do about a blank window on Linux with `Failed to create GBM buffer`.

## 1.3.0 - 2026-11-01

### SID engine

- reSID in place of WebSID: the SID Player and the SID Editor play on the native backend, on resid-rs (a Rust port of
  reSID, the default) or on VA SID Core, both with the MOS 6581 or 8580. A saved WebSID setting moves to reSID.
- Seeking, stereo 2SID and 3SID tunes and the C64 core work with both engines.
- **Play: All** plays the frame-exact JS model of the exported player, like every other preview. The exported player
  and the `.sid` export do not change.
- `src-tauri/vendor/resid-rs` is resid-rs 1.1.1 with one fix: the resampler's FIR interpolation overflowed 32 bits
  (`VENDORED.md`).
- SID Player buffer in seconds: the tune is rendered 10, 15, 20 or 30 s ahead.
- About: reSID and resid-rs in place of the WebSID credit.

### SID Player

- HVSC: the search panel can search composer names only (All / Composer).

### SID Editor

- Tracker keys: the upper row played a semitone too high from `R` on, and F could not be entered from it.

### .sid import

- Closer to the original, measured on the 13 sample tunes against their replay: filter sweeps (also after the waveform went silent, filter tables, LFOs), the pulse range and speed, wave tables (the frames before the next note no longer break a period, steps can last several frames: 1,600 cut tables became 30), and the release of short drum hits (hard restart only when the tune zeroes the ADSR with the gate).

### Window

- The web view's own right-click menu (Refresh, Save as, More tools) is gone; text fields keep theirs for copy and paste.
- VA-VK: the active window's header was unreadable on the light themes.
- SID Editor: the editor itself comes to the front when active, over its floating panels. The VA-VK button brings it back from behind.

### Manual

- New user manual in English: `VA SID Studio Manual.md`, printed to `docs/VA SID Studio Manual.pdf`. The installers carry the PDF, and the new Manual toolbar button opens it.

## 1.2.0 - 2026-11-01

### Two SIDs

- SID Player: VA SID Core plays PSID v3 / v4 tunes with two or three SIDs, in stereo: SID 1 left, SID 2 right, a
  third SID in the centre. Mono tunes stay mono.
- SID Editor: a tune has one or two SIDs (`SID: 1 / 2` in the tracker row), so 3 or 6 voices. Tracker, selection,
  paste, keyboard navigation and the horizontal tracker all follow; dropping the second SID asks first if its voices
  are in use.
- SID Editor: the second SID's address can be set to anything a PSID header can state: `$D420`-`$D7E0` and
  `$DE00`-`$DFE0`.
- Filter and volume are per SID: a voice drives the filter of its own chip.
- Preview in stereo on VA SID Core and the Web Audio synth; WebSID gets the second SID from the PSID header.
- Export: the `.asm` and `.sid` exports have a 6-voice player and a PSID v3 header with the second SID's address.
- `.sid` import: a two-SID tune becomes six voices and keeps its second SID address. With three SIDs the first two
  are imported, with a notice.
- Save: two-SID tunes use a new `.bin` format (`0xFC`). One-SID tunes keep the old format, and old saves still load.

Limits: the `.asm` and `.sid` exports of a two-SID tune hold at most 46 patterns. The UltimateBasic export holds the
first three voices only. The BASIC DATA export numbers its lines further apart for two-SID tunes.

### SID Editor

- New channel spectrum window: one 16-band analyzer per voice during tracker playback. It is computed from the played
  registers (frequency, waveform, pulse width, approximated ADSR, filter, volume), not from the audio, so ring
  modulation, sync and filter resonance do not show, and neither do notes played from the keyboard or MIDI.
- Horizontal tracker: the instrument list fills the full width in even columns and scrolls after about four rows. With
  many instruments it used to squeeze the note view to almost nothing. The help text has its own line.
- Removed the separate `New tune` button; `Files > New tune` remains.

### Other

- Settings: the LCD colour, SID engine and SID chip are loaded at startup. They used to wait for the SID Editor's
  first opening, so the LCD looked green and the SID Player used WebSID until then.
- About: removed the VICE credit line. The README still states the VICE origin and license of the C64 emulation.
- GitHub Actions: a `Build installers` workflow for Windows and macOS (x64, ARM64) and Linux (x64), started by hand or
  by a `v*` tag.
- Tests: two session tests that shared global state no longer run at the same time.
