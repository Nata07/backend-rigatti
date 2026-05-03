const { createProductRepository } = require("../../src/repositories/productRepository");

describe("productRepository", () => {
  let ProductModel;
  let repository;

  beforeEach(() => {
    ProductModel = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndDelete: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    repository = createProductRepository({ ProductModel });
  });

  it("filters findByCompany by companyId", async () => {
    const sortedProducts = [{ name: "Product A" }];
    const sort = jest.fn().mockResolvedValue(sortedProducts);
    ProductModel.find.mockReturnValue({ sort });

    const result = await repository.findByCompany("company-123");

    expect(ProductModel.find).toHaveBeenCalledWith({ companyId: "company-123" });
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(result).toBe(sortedProducts);
  });

  it("finds a product only when the id and companyId match", async () => {
    ProductModel.findOne.mockResolvedValue(null);

    const result = await repository.findByIdAndCompany("product-123", "company-123");

    expect(ProductModel.findOne).toHaveBeenCalledWith({
      _id: "product-123",
      companyId: "company-123",
    });
    expect(result).toBeNull();
  });

  it("creates a product with companyId supplied separately from input data", async () => {
    const productData = {
      name: "Keyboard",
      description: "Mechanical keyboard",
      price: 120,
      category: "Accessories",
    };
    ProductModel.create.mockResolvedValue({ _id: "1", ...productData, companyId: "company-123" });

    await repository.create(productData, "company-123");

    expect(ProductModel.create).toHaveBeenCalledWith({
      ...productData,
      companyId: "company-123",
    });
  });

  it("uses text search when a query is provided", async () => {
    const limit = jest.fn().mockResolvedValue([{ name: "Keyboard Pro" }]);
    const sort = jest.fn().mockReturnValue({ limit });
    const select = jest.fn().mockReturnValue({ sort });
    ProductModel.find.mockReturnValue({ select });

    const result = await repository.searchByCompany({
      companyId: "company-123",
      query: "mechanical keyboard",
      category: "Accessories",
      limit: 3,
    });

    expect(ProductModel.find).toHaveBeenCalledWith({
      companyId: "company-123",
      category: "Accessories",
      $text: { $search: "mechanical keyboard" },
    });
    expect(select).toHaveBeenCalledWith({ score: { $meta: "textScore" } });
    expect(sort).toHaveBeenCalledWith({ score: { $meta: "textScore" } });
    expect(limit).toHaveBeenCalledWith(3);
    expect(result).toEqual([{ name: "Keyboard Pro" }]);
  });

  it("returns all tenant products when query is empty", async () => {
    const limit = jest.fn().mockResolvedValue([{ name: "Mouse" }]);
    const sort = jest.fn().mockReturnValue({ limit });
    ProductModel.find.mockReturnValue({ sort });

    const result = await repository.searchByCompany({
      companyId: "company-123",
      query: "   ",
      limit: 5,
    });

    expect(ProductModel.find).toHaveBeenCalledWith({ companyId: "company-123" });
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(limit).toHaveBeenCalledWith(5);
    expect(result).toEqual([{ name: "Mouse" }]);
  });

  it("unsets imageUrl when updating a product with imagePath", async () => {
    ProductModel.findOneAndUpdate.mockResolvedValue({ _id: "1" });

    await repository.update("product-123", "company-123", {
      name: "Keyboard",
      description: "Mechanical keyboard",
      price: 120,
      category: "Accessories",
      imagePath: "/api/uploads/products/company-123/keyboard.png",
    });

    expect(ProductModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "product-123", companyId: "company-123" },
      {
        $set: {
          name: "Keyboard",
          description: "Mechanical keyboard",
          price: 120,
          category: "Accessories",
          imagePath: "/api/uploads/products/company-123/keyboard.png",
          companyId: "company-123",
        },
        $unset: {
          imageUrl: 1,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );
  });
});
