import { test } from "node:test";
import assert from "node:assert/strict";
import { ICP_PACKAGE_NAME, ICP_PACKAGE_VERSION } from "./index.js";

test("package metadata is exported", () => {
  assert.equal(ICP_PACKAGE_NAME, "@latentspacelabs/icp");
  assert.equal(typeof ICP_PACKAGE_VERSION, "string");
});
