const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the macOS icon is a full-bleed, opaque 1024 x 1024 image: macOS masks it itself", () => {
  const png = fs.readFileSync(path.join(root, "src-tauri/icons/AppIcon.icon/Assets/AppIcon.png"));
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  assert.equal(png[25], 2, "RGB without alpha: transparent corners would bring the light frame back");
  const icon = JSON.parse(read("src-tauri/icons/AppIcon.icon/icon.json"));
  assert.equal(icon.groups[0].layers[0]["image-name"], "AppIcon.png");
});

test("the macOS build compiles the icon and bundles it, and the app names it", () => {
  const mac = JSON.parse(read("src-tauri/tauri.macos.conf.json"));
  assert.equal(mac.build.beforeBuildCommand, "node scripts/build-macos-icon.cjs");
  assert.equal(mac.bundle.macOS.files["Resources/Assets.car"], "icons/generated/Assets.car");
  assert.match(read("src-tauri/Info.plist"), /<key>CFBundleIconName<\/key>\s*<string>AppIcon<\/string>/);
  assert.ok(read(".gitignore").includes("src-tauri/icons/generated/"));
});

test("the installers are built with an Xcode that has Icon Composer support, and the result is checked", () => {
  const dir = path.join(root, ".github/workflows");
  const wf = fs.readdirSync(dir).filter((f) => f.endsWith(".yml")).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  assert.ok(!wf.includes("macos-latest"));
  assert.ok(wf.includes("os: macos-26"));
  assert.ok(wf.includes("VA SID Studio.app/Contents") || wf.includes("VA SID Studio.app"));
  assert.ok(wf.includes("Print :CFBundleIconName"));
});
