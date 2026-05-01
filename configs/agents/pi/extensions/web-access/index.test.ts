import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

describe("web-access extension entrypoint", () => {
  test("registers the web-access tools", () => {
    // Arrange
    const fake = createFakePi();

    // Act
    registerExtension(fake.pi);

    // Assert
    expect([...fake.tools.keys()].sort()).toEqual(["fetch_content", "get_search_content", "web_search"]);
  });
});
