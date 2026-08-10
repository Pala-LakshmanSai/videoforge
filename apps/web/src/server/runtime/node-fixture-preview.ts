import { readFile } from "node:fs/promises";

import type { FixturePreviewBinding } from "./types";

const FIXTURE_PREVIEW_FILE = new URL(
  "../../../public/fixtures/media/watermelon-market.svg",
  import.meta.url,
);

export function createNodeFixturePreviewBinding(): FixturePreviewBinding {
  return {
    read: () => readFile(FIXTURE_PREVIEW_FILE, "utf8"),
  };
}
