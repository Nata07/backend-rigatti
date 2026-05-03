const { createProductService } = require("../../src/services/productService");

describe("productService", () => {
  let productRepository;
  let validateInput;
  let deleteImageFile;
  let productService;

  beforeEach(() => {
    productRepository = {
      create: jest.fn(),
      delete: jest.fn(),
      findByCompany: jest.fn(),
      findByIdAndCompany: jest.fn(),
      update: jest.fn(),
    };
    validateInput = jest.fn((input) => input);
    deleteImageFile = jest.fn();
    productService = createProductService({ productRepository, validateInput, deleteImageFile });
  });

  it("validates required product fields", async () => {
    validateInput.mockImplementation(() => {
      const error = new Error("Invalid input");
      error.name = "ZodError";
      error.issues = [{ message: "Too small: expected string to have >=1 characters" }];
      throw error;
    });

    await expect(
      productService.createProduct(
        {
          description: "Description",
          price: 99,
          category: "Hardware",
        },
        { companyId: "company-123" }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Too small: expected string to have >=1 characters",
    });
  });

  it("rejects zero or negative prices", async () => {
    validateInput.mockImplementation(() => {
      const error = new Error("Invalid input");
      error.name = "ZodError";
      error.issues = [{ message: "Too small: expected number to be >0" }];
      throw error;
    });

    await expect(
      productService.createProduct(
        {
          name: "Keyboard",
          description: "Description",
          price: 0,
          category: "Hardware",
        },
        { companyId: "company-123" }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Too small: expected number to be >0",
    });
  });

  it("accepts an optional valid imageUrl for backward compatibility", async () => {
    const input = {
      name: "Keyboard",
      description: "Description",
      price: 99,
      category: "Hardware",
      imageUrl: "https://example.com/keyboard.png",
    };
    productRepository.create.mockResolvedValue({ id: "product-1", ...input, companyId: "company-123" });

    await productService.createProduct(input, { companyId: "company-123" });

    expect(validateInput).toHaveBeenCalledWith(input);
    expect(productRepository.create).toHaveBeenCalledWith(input, "company-123");
  });

  it("accepts an optional valid imagePath", async () => {
    const input = {
      name: "Keyboard",
      description: "Description",
      price: 99,
      category: "Hardware",
      imagePath: "/api/uploads/products/company-123/keyboard.png",
    };
    productRepository.create.mockResolvedValue({ id: "product-1", ...input, companyId: "company-123" });

    await productService.createProduct(input, { companyId: "company-123" });

    expect(validateInput).toHaveBeenCalledWith(input);
    expect(productRepository.create).toHaveBeenCalledWith(input, "company-123");
  });

  it("rejects an invalid imageUrl", async () => {
    validateInput.mockImplementation(() => {
      const error = new Error("Invalid input");
      error.name = "ZodError";
      error.issues = [{ message: "Invalid URL" }];
      throw error;
    });

    await expect(
      productService.createProduct(
        {
          name: "Keyboard",
          description: "Description",
          price: 99,
          category: "Hardware",
          imageUrl: "not-a-url",
        },
        { companyId: "company-123" }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid URL",
    });
  });

  it("returns products scoped to the authenticated company", async () => {
    const products = [{ _id: "product-1" }];
    productRepository.findByCompany.mockResolvedValue(products);

    const result = await productService.listProducts({ companyId: "company-123" });

    expect(productRepository.findByCompany).toHaveBeenCalledWith("company-123");
    expect(result).toBe(products);
  });

  it("returns 404 when updating a product outside the tenant", async () => {
    productRepository.update.mockResolvedValue(null);

    await expect(
      productService.updateProduct(
        "507f1f77bcf86cd799439011",
        {
          name: "Keyboard",
          description: "Description",
          price: 99,
          category: "Hardware",
        },
        { companyId: "company-123" }
      )
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Product not found",
    });
  });

  it("updates a product with imagePath", async () => {
    const input = {
      name: "Keyboard",
      description: "Description",
      price: 99,
      category: "Hardware",
      imagePath: "/api/uploads/products/company-123/keyboard.png",
    };
    productRepository.update.mockResolvedValue({ _id: "product-1", ...input, companyId: "company-123" });

    await productService.updateProduct("507f1f77bcf86cd799439011", input, {
      companyId: "company-123",
    });

    expect(validateInput).toHaveBeenCalledWith(input);
    expect(productRepository.update).toHaveBeenCalledWith(
      "507f1f77bcf86cd799439011",
      "company-123",
      input
    );
  });

  it("removes the stored image after deleting a product", async () => {
    productRepository.delete.mockResolvedValue({
      _id: "product-1",
      imagePath: "/api/uploads/products/company-123/image.png",
    });

    await productService.deleteProduct("507f1f77bcf86cd799439011", {
      companyId: "company-123",
    });

    expect(deleteImageFile).toHaveBeenCalledWith(
      "/api/uploads/products/company-123/image.png",
      "company-123"
    );
  });
});
