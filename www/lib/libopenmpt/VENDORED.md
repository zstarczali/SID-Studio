# libopenmpt 0.8.10 (WebAssembly)

Plays the tracker modules of the SID Player (Modland, dropped .mod / .xm / .s3m / .it … files).

- Source: https://lib.openmpt.org/files/libopenmpt/dev/libopenmpt-0.8.10+release.dev.js.tar.gz
  (sha256 `\71f930d56141cef1b45d4ecee423617a5daaf9068bb5e2bddd1ce4c3044071a9`), the `bin/wasm` build, unchanged.
- `libopenmpt.wasm` sha256 `7d3c33cb6c7ee3fd5ef10cc62dcc676541d33455e355cf2dde4bd0d8a5f40139`
- License: BSD-3-Clause (`LICENSE.txt`); bundled parts in `licenses/` (minimp3, miniz, stb_vorbis, BSL-1.0 parts).

The build exports only `_malloc`, `_free` and the `_openmpt_*` functions, not the
memory views: `www/sid-editor.js` (`_modLib`) instantiates the wasm itself through
`Module.instantiateWasm` and reads the exported `WebAssembly.Memory`.

To update: unpack the newer `…+release.dev.js.tar.gz`, copy `bin/wasm/libopenmpt.js`
and `libopenmpt.wasm` here, update the version in this file and `_MOD_LIB_VERSION`.
