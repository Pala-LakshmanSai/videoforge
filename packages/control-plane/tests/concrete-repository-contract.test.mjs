import test from "node:test";

import { registerRepositoryContractSuite } from "../dist/src/repositories/contract-suite.js";
import { concretePGliteAdapterFactory } from "./support/concrete-adapter-factory.mjs";

registerRepositoryContractSuite(test, concretePGliteAdapterFactory, {
  name: "concrete PGlite adapter",
});
