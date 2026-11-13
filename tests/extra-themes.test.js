const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "www");
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

for (const theme of ["ruby", "amethyst", "phosphor", "retro80", "retro8"]) {
  test(`${theme} theme is wired into the CSS, picker and head script`, () => {
    const block = [...css.matchAll(new RegExp(`html\\[data-theme="${theme}"\\] \\{([^}]*)\\}`, "g"))]
      .find(m => m[1].includes("--bg:"));
    assert.ok(block, `missing html[data-theme="${theme}"] token block`);
    for (const token of ["--bg", "--panel", "--text", "--primary", "--control-bg", "--input-bg"]) {
      assert.ok(block[1].includes(`${token}:`), `${theme}: ${token} not defined`);
    }
    assert.ok(css.includes(`.theme-option-dot[data-theme-opt="${theme}"]`), `${theme}: picker dot colour missing`);
    assert.ok(html.includes(`data-theme-opt="${theme}" type="button"`), `${theme}: picker option missing`);
    assert.ok(new RegExp(`'${theme}':'#[0-9a-fA-F]{6}'`).test(html), `${theme}: head script background missing`);
  });
}
