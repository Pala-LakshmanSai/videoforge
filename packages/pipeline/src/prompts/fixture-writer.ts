import type { PromptBatch, PromptWriterBatchOutput, PromptWriterPort } from "./types.js";

export class DeterministicFixturePromptWriter implements PromptWriterPort {
  async write(batch: PromptBatch): Promise<PromptWriterBatchOutput> {
    return Object.freeze({
      batch_id: batch.batchId,
      scenes: Object.freeze(
        batch.scenes.map((scene) =>
          Object.freeze({
            scene_id: scene.sceneId,
            literal_subject: scene.phrase,
            action: "shown as a literal visible action",
            environment: scene.priorContext ?? scene.nextContext ?? "the stated real-world setting",
            in_image_shot_role: scene.inImageShotRole,
            lighting_context: "available practical light",
            continuity_tags: batch.continuityTags,
            prompt_core: `${scene.phrase}, shown literally in ${scene.inImageShotRole.toLowerCase().replaceAll("_", " ")} framing`,
          }),
        ),
      ),
    });
  }
}
