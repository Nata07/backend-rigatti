const { deriveImagePathFromUrl } = require("../../scripts/migrate-image-paths.ts");

describe("migrate-image-paths", () => {
  it("derives an API imagePath from an existing upload URL", () => {
    expect(
      deriveImagePathFromUrl("http://localhost:3001/uploads/products/company-123/file.png")
    ).toBe("/api/uploads/products/company-123/file.png");
  });

  it("returns null for non-upload URLs", () => {
    expect(deriveImagePathFromUrl("https://example.com/file.png")).toBeNull();
  });
});
