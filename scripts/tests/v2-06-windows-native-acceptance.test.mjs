import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const harness = await readFile("apps/media-worker-desktop/windows-native-acceptance.ps1", "utf8");
const desktopReadme = await readFile("apps/media-worker-desktop/README.md", "utf8");

test("Windows native acceptance harness is bounded and release-pinned", () => {
  assert.match(harness, /ValidateRange\(60, 1800\)/u);
  assert.match(harness, /schema_version = "videoforge-windows-native-acceptance\/v1"/u);
  assert.match(harness, /videoforge-media-worker-release\/v1/u);
  assert.match(harness, /UNSIGNED_BETA/u);
  assert.match(harness, /Get-AuthenticodeSignature/u);
  assert.match(harness, /Get-FileHash/u);
  assert.match(harness, /Assert-WindowsX64/u);
  assert.match(harness, /\/VERYSILENT/u);
  assert.match(harness, /\/DIR=/u);
  assert.match(harness, /WScript\.Shell/u);
  assert.match(harness, /--background/u);
  assert.match(harness, /cmdkey\.exe/u);
  assert.match(harness, /credential_values_read = \$false/u);
  assert.match(harness, /finally/u);
  assert.match(harness, /Invoke-Uninstaller/u);
  assert.match(harness, /KeepInstallation/u);
  assert.match(harness, /\[AllowEmptyString\(\)\]\s*\[string\]\$ExpectedVersion/u);
  assert.match(harness, /\$existingProcesses = @\(Get-WorkerProcesses\)/u);
  assert.match(harness, /\$remainingInstallItems = @\(Get-ChildItem -LiteralPath \$Root -Force\)/u);
  assert.match(harness, /empty isolated install root remains after cleanup/u);
});

test("default Windows acceptance path is provider-free and has no direct network tooling", () => {
  assert.match(harness, /RunHostedPairing/u);
  assert.match(harness, /no network or provider request was started/u);
  assert.doesNotMatch(
    harness,
    /Invoke-WebRequest|Invoke-RestMethod|curl(?:\.exe)?|wrangler|gh release|runpod/iu,
  );
  assert.doesNotMatch(harness, /authorization\s*[:=]|device_token|poll_token/iu);
});

test("desktop documentation exposes the one-run Windows handoff", () => {
  assert.match(desktopReadme, /windows-native-acceptance\.ps1/u);
  assert.match(desktopReadme, /media-worker-v0\.1\.11/u);
  assert.match(desktopReadme, /-RunHostedPairing/u);
  assert.match(desktopReadme, /PreviousReleaseManifestPath/u);
  assert.match(desktopReadme, /SmartScreen/u);
  assert.match(desktopReadme, /sleep\/wake/u);
});
