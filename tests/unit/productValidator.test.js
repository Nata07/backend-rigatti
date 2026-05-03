const {
  PRODUCT_IMAGE_PATH_PREFIX,
  validateProductInput,
} = require("../../src/validators/productValidator");

describe("productValidator", () => {
  it("accepts a valid imagePath", () => {
    const result = validateProductInput({
      name: "Keyboard",
      description: "Mechanical keyboard",
      price: 120,
      category: "Accessories",
      imagePath: "/api/uploads/products/company-123/keyboard.png",
    });

    expect(result.imagePath).toBe("/api/uploads/products/company-123/keyboard.png");
  });

  it("rejects an invalid imagePath", () => {
    expect(() =>
      validateProductInput({
        name: "Keyboard",
        description: "Mechanical keyboard",
        price: 120,
        category: "Accessories",
        imagePath: "/uploads/products/company-123/keyboard.png",
      })
    ).toThrow("imagePath must match /api/uploads/products/:companyId/:filename");
  });

  it("rejects payloads that include both imageUrl and imagePath", () => {
    expect(() =>
      validateProductInput({
        name: "Keyboard",
        description: "Mechanical keyboard",
        price: 120,
        category: "Accessories",
        imageUrl: "https://example.com/keyboard.png",
        imagePath: "/api/uploads/products/company-123/keyboard.png",
      })
    ).toThrow("Provide either imageUrl or imagePath, not both");
  });

  it("documents the expected imagePath prefix", () => {
    expect(PRODUCT_IMAGE_PATH_PREFIX).toBe("/api/uploads/products/");
  });
});
