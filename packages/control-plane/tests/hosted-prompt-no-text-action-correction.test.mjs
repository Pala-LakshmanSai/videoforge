import assert from "node:assert/strict";
import test from "node:test";
import { withPgcryptoMigratedDatabase } from "./support/pglite.mjs";
import {
  PROMPT_CONTENT_REPAIR_INSTRUCTION,
  NO_GRAPHICS_V2_WRITER_INSTRUCTION,
} from "../../pipeline/dist/src/prompts/runware-deepseek-writer.js";

test("0280 admits only exact versioned no-text suffixes, retaining every other request field", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const original = {
      taskUUID: "original",
      model: "model",
      settings: { systemPrompt: "sealed", temperature: 0.2 },
      messages: [{ role: "user", content: "exact scene facts" }],
    };
    const matches = async (a, b) =>
      (
        await executor.query(
          "SELECT videoforge_hosted_prompt_content_repair_matches($1::jsonb,$2::jsonb) AS matches",
          [JSON.stringify(a), JSON.stringify(b)],
        )
      ).rows[0].matches;
    for (const suffix of [
      PROMPT_CONTENT_REPAIR_INSTRUCTION,
      PROMPT_CONTENT_REPAIR_INSTRUCTION + "\n" + NO_GRAPHICS_V2_WRITER_INSTRUCTION,
    ]) {
      const replacement = {
        ...original,
        taskUUID: "replacement",
        settings: {
          ...original.settings,
          systemPrompt: original.settings.systemPrompt + "\n" + suffix,
        },
      };
      assert.equal(await matches(original, replacement), true);
      assert.equal(await matches(original, { ...replacement, model: "different" }), false);
      assert.equal(
        await matches(original, {
          ...replacement,
          messages: [{ role: "user", content: "different" }],
        }),
        false,
      );
      assert.equal(
        await matches(original, {
          ...replacement,
          settings: { ...replacement.settings, temperature: 0.8 },
        }),
        false,
      );
      assert.equal(
        await matches(original, {
          ...replacement,
          settings: {
            ...replacement.settings,
            systemPrompt: replacement.settings.systemPrompt + " modified",
          },
        }),
        false,
      );
    }
    const v28 = {
      ...original,
      settings: {
        ...original.settings,
        systemPrompt: "sealed\n" + PROMPT_CONTENT_REPAIR_INSTRUCTION,
      },
    };
    assert.equal(
      await matches(v28, {
        ...v28,
        taskUUID: "v2",
        settings: {
          ...v28.settings,
          systemPrompt: v28.settings.systemPrompt + "\n" + NO_GRAPHICS_V2_WRITER_INSTRUCTION,
        },
      }),
      true,
    );
    assert.equal(
      await matches(original, {
        ...original,
        taskUUID: "v2",
        settings: {
          ...original.settings,
          systemPrompt: "sealed\n" + NO_GRAPHICS_V2_WRITER_INSTRUCTION,
        },
      }),
      false,
    );
  });
});
