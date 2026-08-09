import assert from "node:assert/strict";
import test from "node:test";

import { parseListeningProcess } from "../process.mjs";

test("lsof listener output retains the owner and wildcard binding", () => {
  assert.deepEqual(parseListeningProcess("p65282\ncnode\nf16\nn*:4173"), {
    pid: 65282,
    command: "node",
    address: "*:4173",
  });
});

test("missing or unowned listener output is rejected", () => {
  assert.equal(parseListeningProcess(null), null);
  assert.equal(parseListeningProcess("cnode\nn127.0.0.1:4173"), null);
});
