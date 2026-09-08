import { expect, test } from "bun:test";
import { createBrowserUseKernel } from "./kernel";
import { resolveBrowserUsePaths } from "./paths";

test("the installed kernel accepts initialization and preserves JavaScript bindings", async () => {
  // Arrange
  const paths = resolveBrowserUsePaths();
  if (!paths.available) throw new Error(paths.reason);
  const kernel = await createBrowserUseKernel(paths);

  try {
    // Act
    const first = await kernel.execute("const value = 1; nodeRepl.write(value);");
    await kernel.endTurn();
    const second = await kernel.execute("nodeRepl.write(value + 1);");

    // Assert
    expect(first).toMatchObject({ text: "1", isError: false });
    expect(second).toMatchObject({ text: "2", isError: false });
  } finally {
    await kernel.close();
  }
}, 90_000);
