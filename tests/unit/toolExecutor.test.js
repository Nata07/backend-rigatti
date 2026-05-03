const { createToolExecutor } = require("../../src/services/toolExecutor");

describe("toolExecutor", () => {
  let productSearchService;
  let toolExecutor;

  beforeEach(() => {
    productSearchService = {
      searchForCompany: jest.fn().mockResolvedValue([{ id: "product-1", name: "Keyboard" }]),
    };
    toolExecutor = createToolExecutor({ productSearchService });
  });

  it("accepts empty query input and injects companyId", async () => {
    await toolExecutor.executeToolCall(
      {
        id: "call-1",
        name: "search_products",
        argumentsJson: JSON.stringify({ limit: 3 }),
      },
      { companyId: "company-123" }
    );

    expect(productSearchService.searchForCompany).toHaveBeenCalledWith({
      companyId: "company-123",
      limit: 3,
    });
  });

  it("injects companyId from AuthContext into product search", async () => {
    await toolExecutor.executeToolCall(
      {
        id: "call-1",
        name: "search_products",
        argumentsJson: JSON.stringify({ query: "keyboard", limit: 3 }),
      },
      { companyId: "company-123" }
    );

    expect(productSearchService.searchForCompany).toHaveBeenCalledWith({
      companyId: "company-123",
      query: "keyboard",
      limit: 3,
    });
  });

  it("rejects unknown tools", async () => {
    await expect(
      toolExecutor.executeToolCall(
        {
          id: "call-1",
          name: "unknown_tool",
          argumentsJson: "{}",
        },
        { companyId: "company-123" }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Unknown tool",
    });
  });

  it("rejects invalid JSON tool arguments", async () => {
    await expect(
      toolExecutor.executeToolCall(
        {
          id: "call-1",
          name: "search_products",
          argumentsJson: "{invalid-json",
        },
        { companyId: "company-123" }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Tool arguments must be valid JSON",
    });
  });

  it("defaults invalid limit values and clamps values above the maximum", async () => {
    await toolExecutor.executeToolCall(
      {
        id: "call-1",
        name: "search_products",
        argumentsJson: JSON.stringify({ query: "keyboard", limit: 0 }),
      },
      { companyId: "company-123" }
    );

    await toolExecutor.executeToolCall(
      {
        id: "call-2",
        name: "search_products",
        argumentsJson: JSON.stringify({ query: "keyboard", limit: 999 }),
      },
      { companyId: "company-123" }
    );

    expect(productSearchService.searchForCompany).toHaveBeenNthCalledWith(1, {
      companyId: "company-123",
      query: "keyboard",
      limit: 10,
    });
    expect(productSearchService.searchForCompany).toHaveBeenNthCalledWith(2, {
      companyId: "company-123",
      query: "keyboard",
      limit: 50,
    });
  });

  it("rejects empty category filters", async () => {
    await expect(
      toolExecutor.executeToolCall(
        {
          id: "call-1",
          name: "search_products",
          argumentsJson: JSON.stringify({ query: "keyboard", category: "   " }),
        },
        { companyId: "company-123" }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "category cannot be empty",
    });
  });
});
