import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import registerStructuredOutputRuntime, { WORKFLOW_STRUCTURED_SCHEMA_FILE_ENV } from "./structured-output-runtime";

describe("dynamic workflow structured output runtime", () => {
  let tempDir: string | undefined;
  const originalSchemaFile = process.env[WORKFLOW_STRUCTURED_SCHEMA_FILE_ENV];

  afterEach(async () => {
    if (originalSchemaFile === undefined) delete process.env[WORKFLOW_STRUCTURED_SCHEMA_FILE_ENV];
    else process.env[WORKFLOW_STRUCTURED_SCHEMA_FILE_ENV] = originalSchemaFile;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("registers structured_output from the schema file", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-workflow-schema-"));
    const schemaFile = join(tempDir, "schema.json");
    await writeFile(schemaFile, JSON.stringify({ type: "object", properties: { ok: { type: "boolean" } } }), "utf8");
    process.env[WORKFLOW_STRUCTURED_SCHEMA_FILE_ENV] = schemaFile;
    const fakePi = createFakePi();

    // Act
    registerStructuredOutputRuntime(fakePi.pi);
    const result = await fakePi.runTool("structured_output", { ok: true });

    // Assert
    expect(fakePi.tools.has("structured_output")).toBe(true);
    expect(result).toMatchObject({ details: { ok: true }, terminate: true });
  });

  test("does nothing without a schema file", () => {
    // Arrange
    delete process.env[WORKFLOW_STRUCTURED_SCHEMA_FILE_ENV];
    const fakePi = createFakePi();

    // Act
    registerStructuredOutputRuntime(fakePi.pi);

    // Assert
    expect(fakePi.tools.has("structured_output")).toBe(false);
  });
});
