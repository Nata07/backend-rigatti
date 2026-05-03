const path = require("path");

const {
  PRODUCT_IMAGE_ALLOWED_MIME_TYPES,
  PRODUCT_IMAGE_MAX_SIZE_BYTES,
  buildProductImageFilename,
  buildProductImagePath,
  productImageFileFilter,
  resolveProductImageDirectory,
} = require("../../src/routes/uploads.ts");

describe("uploads route helpers", () => {
  it("creates a tenant-specific directory", () => {
    const mkdirSync = jest.fn();
    const uploadsRoot = path.join("tmp", "uploads");

    const directory = resolveProductImageDirectory("company-123", {
      uploadsRoot,
      mkdirSync,
    });

    expect(directory).toBe(path.join(uploadsRoot, "company-123"));
    expect(mkdirSync).toHaveBeenCalledWith(path.join(uploadsRoot, "company-123"), {
      recursive: true,
    });
  });

  it("builds unique filenames using a UUID-compatible id generator", () => {
    const filename = buildProductImageFilename("photo.PNG", () => "generated-id");

    expect(filename).toBe("generated-id.png");
  });

  it("accepts jpeg, png, and webp MIME types", () => {
    for (const mimetype of PRODUCT_IMAGE_ALLOWED_MIME_TYPES) {
      const callback = jest.fn();

      productImageFileFilter({}, { mimetype }, callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    }
  });

  it("rejects invalid MIME types", () => {
    const callback = jest.fn();

    productImageFileFilter({}, { mimetype: "image/gif" }, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Invalid file type",
      })
    );
  });

  it("exposes the 5MB upload limit", () => {
    expect(PRODUCT_IMAGE_MAX_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  it("builds image API paths with company isolation", () => {
    expect(buildProductImagePath("company-123", "file.png")).toBe(
      "/api/uploads/products/company-123/file.png"
    );
  });
});
