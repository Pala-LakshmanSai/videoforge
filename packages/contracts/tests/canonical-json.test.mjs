import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalizeJson,
  canonicalizeJsonToUtf8,
  JsonCanonicalizationError,
  sha256CanonicalJson,
} from "../dist/src/index.js";

// Authoritative vectors: https://www.rfc-editor.org/rfc/rfc8785 (section 3.2 and appendix B).
const rfc8785Input = {
  numbers: [Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27],
  string: '€$\u000f\nA\'B"\\\\"/',
  literals: [null, true, false],
};

const rfc8785Canonical =
  '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}';

const loadFixture = async (filename) =>
  JSON.parse(await readFile(new URL(`../generated/fixtures/${filename}`, import.meta.url), "utf8"));

test("matches the RFC 8785 section 3.2 canonicalization and UTF-8 vector", () => {
  assert.equal(canonicalizeJson(rfc8785Input), rfc8785Canonical);
  assert.deepEqual(
    [...canonicalizeJsonToUtf8(rfc8785Input)],
    [...Buffer.from(rfc8785Canonical, "utf8")],
  );
});

test("matches the RFC 8785 UTF-16 property sorting vector", () => {
  const input = {
    "€": "Euro Sign",
    "\r": "Carriage Return",
    דּ: "Hebrew Letter Dalet With Dagesh",
    1: "One",
    "😀": "Emoji: Grinning Face",
    "\u0080": "Control",
    ö: "Latin Small Letter O With Diaeresis",
  };

  assert.equal(
    canonicalizeJson(input),
    '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
  );
});

const numberVectors = [
  ["0000000000000000", "0"],
  ["8000000000000000", "0"],
  ["0000000000000001", "5e-324"],
  ["8000000000000001", "-5e-324"],
  ["7fefffffffffffff", "1.7976931348623157e+308"],
  ["ffefffffffffffff", "-1.7976931348623157e+308"],
  ["4340000000000000", "9007199254740992"],
  ["c340000000000000", "-9007199254740992"],
  ["4430000000000000", "295147905179352830000"],
  ["44b52d02c7e14af5", "9.999999999999997e+22"],
  ["44b52d02c7e14af6", "1e+23"],
  ["44b52d02c7e14af7", "1.0000000000000001e+23"],
  ["444b1ae4d6e2ef4e", "999999999999999700000"],
  ["444b1ae4d6e2ef4f", "999999999999999900000"],
  ["444b1ae4d6e2ef50", "1e+21"],
  ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
  ["3eb0c6f7a0b5ed8d", "0.000001"],
  ["41b3de4355555553", "333333333.3333332"],
  ["41b3de4355555554", "333333333.33333325"],
  ["41b3de4355555555", "333333333.3333333"],
  ["41b3de4355555556", "333333333.3333334"],
  ["41b3de4355555557", "333333333.33333343"],
  ["becbf647612f3696", "-0.0000033333333333333333"],
  ["43143ff3c1cb0959", "1424953923781206.2"],
];

test("matches every finite IEEE 754 number vector in RFC 8785 appendix B", () => {
  for (const [bits, expected] of numberVectors) {
    const value = Buffer.from(bits, "hex").readDoubleBE(0);
    assert.equal(canonicalizeJson(value), expected, bits);
  }
});

test("is independent of object insertion order at every depth", async () => {
  const shared = { z: 3, a: 1 };
  const first = { z: [{ b: 2, a: 1 }, shared], a: true };
  const second = {
    a: true,
    z: [
      { a: 1, b: 2 },
      { a: 1, z: 3 },
    ],
  };

  assert.equal(canonicalizeJson(first), canonicalizeJson(second));
  assert.equal(await sha256CanonicalJson(first), await sha256CanonicalJson(second));
  assert.notEqual(canonicalizeJson([1, 2]), canonicalizeJson([2, 1]));
});

test("hashes the official canonical sample in project digest format", async () => {
  assert.equal(
    await sha256CanonicalJson(rfc8785Input),
    "sha256:2d5e01a318d0f0879ab568c4be289c8b1f64ef8921a53c6277d5e069978baacb",
  );
});

test("reproduces every JCS payload linkage in the synthetic golden chain", async () => {
  const [avatar, style, revision, timeline, renderManifest, production] = await Promise.all([
    loadFixture("avatar_profile_version.valid.json"),
    loadFixture("default_image_style_v1.json"),
    loadFixture("project_revision_config.valid.json"),
    loadFixture("timeline_plan.valid.json"),
    loadFixture("resolved_render_manifest.valid.json"),
    loadFixture("production_manifest.valid.json"),
  ]);

  const avatarHash = await sha256CanonicalJson(avatar);
  const styleHash = await sha256CanonicalJson(style);
  const revisionHash = await sha256CanonicalJson(revision);
  const timelineHash = await sha256CanonicalJson(timeline);
  const renderManifestHash = await sha256CanonicalJson(renderManifest);

  assert.equal(revision.avatar_binding.avatar_profile_hash, avatarHash);
  assert.equal(revision.style_profile_hash, styleHash);
  assert.equal(timeline.revision_config_hash, revisionHash);
  assert.equal(renderManifest.revision_config_hash, revisionHash);
  assert.equal(renderManifest.timeline_plan_hash, timelineHash);
  assert.equal(production.revision_config_hash, revisionHash);
  assert.equal(production.timeline_plan.sha256, timelineHash);
  assert.equal(production.resolved_render_manifest.sha256, renderManifestHash);
  assert.equal(production.avatar_binding.avatar_profile_hash, avatarHash);
  assert.equal(production.style_binding.style_profile_hash, styleHash);
});

const expectCanonicalizationError = (value, expectedCode) => {
  assert.throws(
    () => canonicalizeJson(value),
    (error) =>
      error instanceof JsonCanonicalizationError &&
      error.code === expectedCode &&
      error.message.includes(" at $"),
  );
};

test("rejects values outside the I-JSON data model instead of coercing or omitting them", () => {
  for (const value of [undefined, 1n, Symbol("value"), () => true]) {
    expectCanonicalizationError(value, "INVALID_TYPE");
  }

  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    expectCanonicalizationError(value, "NON_FINITE_NUMBER");
  }

  expectCanonicalizationError({ invalid: undefined }, "INVALID_TYPE");
  expectCanonicalizationError([undefined], "INVALID_TYPE");
  expectCanonicalizationError(new Date(0), "NON_PLAIN_OBJECT");
  expectCanonicalizationError(new Map(), "NON_PLAIN_OBJECT");
});

test("rejects sparse arrays, cycles, accessors, and non-JSON properties", () => {
  expectCanonicalizationError(new Array(1), "SPARSE_ARRAY");

  const cycle = {};
  cycle.self = cycle;
  expectCanonicalizationError(cycle, "CYCLIC_REFERENCE");

  const accessor = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
  expectCanonicalizationError(accessor, "ACCESSOR_PROPERTY");

  const hidden = {};
  Object.defineProperty(hidden, "value", { enumerable: false, value: 1 });
  expectCanonicalizationError(hidden, "UNSUPPORTED_PROPERTY");

  const symbolProperty = { valid: true };
  symbolProperty[Symbol("hidden")] = false;
  expectCanonicalizationError(symbolProperty, "UNSUPPORTED_PROPERTY");

  const extendedArray = [1];
  extendedArray.label = "not JSON";
  expectCanonicalizationError(extendedArray, "UNSUPPORTED_PROPERTY");
});

test("rejects lone surrogates while preserving valid pairs and normalization", () => {
  expectCanonicalizationError("\ud800", "INVALID_UNICODE");
  expectCanonicalizationError("\udc00", "INVALID_UNICODE");
  expectCanonicalizationError({ ["\ud800"]: true }, "INVALID_UNICODE");

  assert.equal(canonicalizeJson("\ud83d\ude00"), '"😀"');
  assert.notEqual(canonicalizeJson("é"), canonicalizeJson("e\u0301"));
});
