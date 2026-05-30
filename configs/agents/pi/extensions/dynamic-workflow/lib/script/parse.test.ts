import { describe, expect, test } from "bun:test";
import { parseWorkflowScript } from "./parse";

const validScript = `export const meta = {
  name: 'demo_workflow',
  description: 'A useful workflow',
  whenToUse: 'When testing parser behavior',
  phases: [{ title: 'Scan', detail: 'Collect inputs', model: 'default' }]
}

phase('Scan')
return { ok: true }
`;

describe("parseWorkflowScript", () => {
  test("accepts literal workflow metadata", () => {
    // Arrange
    const script = validScript;

    // Act
    const parsed = parseWorkflowScript(script);

    // Assert
    expect(parsed.meta.name).toBe("demo_workflow");
    expect(parsed.meta.description).toBe("A useful workflow");
    expect(parsed.meta.phases).toEqual([{ title: "Scan", detail: "Collect inputs", model: "default" }]);
    expect(parsed.body).toContain("phase('Scan')");
    expect(parsed.body).not.toContain("export const meta");
  });

  test("accepts static template literals in metadata", () => {
    // Arrange
    const script = "export const meta = { name: `demo`, description: `static` }\nreturn true";

    // Act
    const parsed = parseWorkflowScript(script);

    // Assert
    expect(parsed.meta.name).toBe("demo");
    expect(parsed.meta.description).toBe("static");
  });

  test("requires meta export first", () => {
    // Arrange
    const script = "const x = 1\nexport const meta = { name: 'demo', description: 'desc' }";

    // Act / Assert
    expect(() => parseWorkflowScript(script)).toThrow(/must be the first statement/);
  });

  test("requires name and description", () => {
    // Arrange
    const missingDescription = "export const meta = { name: 'demo' }";
    const missingName = "export const meta = { description: 'desc' }";

    // Act / Assert
    expect(() => parseWorkflowScript(missingDescription)).toThrow(/meta.description/);
    expect(() => parseWorkflowScript(missingName)).toThrow(/meta.name/);
  });

  test("rejects non-literal metadata", () => {
    // Arrange
    const callExpression = "export const meta = { name: makeName(), description: 'desc' }";
    const identifier = "export const meta = { name: name, description: 'desc' }";

    // Act / Assert
    expect(() => parseWorkflowScript(callExpression)).toThrow(/non-literal node type.*CallExpression/);
    expect(() => parseWorkflowScript(identifier)).toThrow(/non-literal node type.*Identifier/);
  });

  test("rejects object and array hazards", () => {
    // Arrange
    const spreadObject = "export const meta = { ...base, name: 'demo', description: 'desc' }";
    const computedKey = "export const meta = { ['name']: 'demo', description: 'desc' }";
    const reservedKey = "export const meta = { __proto__: {}, name: 'demo', description: 'desc' }";
    const sparseArray = "export const meta = { name: 'demo', description: 'desc', phases: [,,] }";

    // Act / Assert
    expect(() => parseWorkflowScript(spreadObject)).toThrow(/spread not allowed/);
    expect(() => parseWorkflowScript(computedKey)).toThrow(/computed keys not allowed/);
    expect(() => parseWorkflowScript(reservedKey)).toThrow(/reserved key name/);
    expect(() => parseWorkflowScript(sparseArray)).toThrow(/sparse arrays not allowed/);
  });

  test("rejects extra exports after metadata", () => {
    // Arrange
    const script = "export const meta = { name: 'demo', description: 'desc' }\nexport const x = 1";

    // Act / Assert
    expect(() => parseWorkflowScript(script)).toThrow(/only export the first meta/);
  });
});
