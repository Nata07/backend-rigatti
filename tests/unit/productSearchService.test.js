const { createProductSearchService, validateSearchArguments } = require("../../src/services/productSearchService");

describe("productSearchService", () => {
  let productRepository;
  let productSearchService;

  beforeEach(() => {
    productRepository = {
      searchByCompany: jest.fn(),
    };
    productSearchService = createProductSearchService({ productRepository });
  });

  it("requires companyId", async () => {
    await expect(
      productSearchService.searchForCompany({
        query: "keyboard",
        limit: 5,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid input: expected string, received undefined",
    });
  });

  it("filters by companyId and category", async () => {
    productRepository.searchByCompany.mockResolvedValue([
      {
        _id: "507f1f77bcf86cd799439011",
        name: "Keyboard",
        description: "Mechanical keyboard",
        price: 120,
        category: "Accessories",
        imageUrl: "https://example.com/keyboard.png",
      },
    ]);

    const result = await productSearchService.searchForCompany({
      companyId: "company-123",
      query: "keyboard",
      category: "Accessories",
      limit: 3,
    });

    expect(productRepository.searchByCompany).toHaveBeenCalledWith({
      companyId: "company-123",
      query: "keyboard",
      category: "Accessories",
      limit: 3,
    });
    expect(result).toEqual([
      {
        id: "507f1f77bcf86cd799439011",
        name: "Keyboard",
        description: "Mechanical keyboard",
        price: 120,
        category: "Accessories",
        imageUrl: "https://example.com/keyboard.png",
      },
    ]);
  });

  it("returns all tenant products when query is omitted", async () => {
    productRepository.searchByCompany.mockResolvedValue([]);

    await productSearchService.searchForCompany({
      companyId: "company-123",
      limit: 5,
    });

    expect(productRepository.searchByCompany).toHaveBeenCalledWith({
      companyId: "company-123",
      query: "",
      limit: 5,
    });
  });

  it("rejects invalid limits before querying", async () => {
    await expect(
      productSearchService.searchForCompany({
        companyId: "company-123",
        query: "keyboard",
        limit: 25,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "limit must be at most 20",
    });

    expect(productRepository.searchByCompany).not.toHaveBeenCalled();
  });

  it("trims and validates raw tool arguments", () => {
    expect(
      validateSearchArguments({
        companyId: " company-123 ",
        query: " keyboard ",
        category: " Accessories ",
        limit: "4",
      })
    ).toEqual({
      companyId: "company-123",
      query: "keyboard",
      category: "Accessories",
      limit: 4,
    });
  });

  it("rejects empty category values", async () => {
    await expect(
      productSearchService.searchForCompany({
        companyId: "company-123",
        query: "",
        category: "   ",
        limit: 5,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "category cannot be empty",
    });
  });

  it("rethrows unexpected validation errors", () => {
    expect(() => validateSearchArguments(Symbol("bad"))).toThrow();
  });
});
