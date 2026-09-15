'use strict';
// sharp's native prebuilt binaries (@img/sharp-<platform>) statically bundle their
// own GObject/GLib and export those symbols globally. Electron's own binary already
// links system GObject as a direct dependency, so when sharp's native .node is
// dlopen'd inside the Electron process, ELF symbol interposition makes libvips'
// internal g_object_unref calls resolve to the *system* GObject instead of the
// bundled one — a NULL-vtable jump and a SIGSEGV on first use (confirmed via core
// dump). @img/sharp-wasm32 links no glib at all, so the collision can't happen.
//
// sharp's own module resolution (lib/sharp.js) always tries the native platform
// binary first, so the only way to force wasm is to make sure the native one isn't
// present at all. And npm's own installer refuses to install @img/sharp-wasm32 as
// a normal dependency in the first place — it's cpu-gated to "wasm32" in its own
// package.json, and even `--cpu=wasm32` doesn't override that on every npm version
// in use across this project's dev/CI machines — so instead of relying on `npm
// install` for it, this script fetches the exact tarball `npm pack` would (which
// isn't subject to the installability check) and extracts it by hand, then deletes
// every native @img/sharp-*/@img/sharp-libvips-* package so sharp has nothing to
// resolve but wasm.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const imgDir = path.join(root, 'node_modules', '@img');
const wasmDir = path.join(imgDir, 'sharp-wasm32');

function sharpWasmVersion() {
  const sharpPkg = require(path.join(root, 'node_modules', 'sharp', 'package.json'));
  const version = sharpPkg.optionalDependencies && sharpPkg.optionalDependencies['@img/sharp-wasm32'];
  if (!version) throw new Error('Could not find @img/sharp-wasm32 version in sharp/package.json');
  return version;
}

function installSharpWasm(version) {
  if (fs.existsSync(wasmDir)) {
    const installed = require(path.join(wasmDir, 'package.json')).version;
    if (installed === version) return;
    fs.rmSync(wasmDir, { recursive: true, force: true });
  }
  console.log(`[force-sharp-wasm] fetching @img/sharp-wasm32@${version}`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharp-wasm32-'));
  try {
    execFileSync('npm', ['pack', `@img/sharp-wasm32@${version}`, '--pack-destination', tmpDir], {
      stdio: 'inherit',
      // On Windows, `npm` resolves to `npm.cmd`, which execFileSync only finds via a shell.
      shell: process.platform === 'win32',
    });
    const tgz = fs.readdirSync(tmpDir).find((f) => f.endsWith('.tgz'));
    if (!tgz) throw new Error('npm pack did not produce a .tgz');
    fs.mkdirSync(imgDir, { recursive: true });
    execFileSync('tar', ['xzf', path.join(tmpDir, tgz), '-C', tmpDir]);
    fs.mkdirSync(wasmDir, { recursive: true });
    fs.cpSync(path.join(tmpDir, 'package'), wasmDir, { recursive: true });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function removeNativeSharpBinaries() {
  if (!fs.existsSync(imgDir)) return;
  for (const name of fs.readdirSync(imgDir)) {
    if (name === 'sharp-wasm32' || !name.startsWith('sharp-')) continue;
    fs.rmSync(path.join(imgDir, name), { recursive: true, force: true });
    console.log(`[force-sharp-wasm] removed native @img/${name}`);
  }
}

installSharpWasm(sharpWasmVersion());
removeNativeSharpBinaries();
