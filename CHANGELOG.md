# Changelog

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
