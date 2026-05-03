const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");

const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { Company, Product } = require("../../src/models");
const { createProductRepository } = require("../../src/repositories/productRepository");
const { createProductSearchService } = require("../../src/services/productSearchService");

describe("productSearchService integration", () => {
  let mongoServer;
  let productSearchService;
  let companyAId;
  let companyBId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Promise.all([Company.syncIndexes(), Product.syncIndexes()]);
  });

  beforeEach(async () => {
    await Promise.all([Company.deleteMany({}), Product.deleteMany({})]);

    const companyA = await Company.create({ name: "Company A" });
    const companyB = await Company.create({ name: "Company B" });
    companyAId = companyA._id.toString();
    companyBId = companyB._id.toString();

    await Product.create([
      {
        companyId: companyA._id,
        name: "Keyboard Pro",
        description: "Mechanical keyboard for engineering teams",
        price: 120,
        category: "Accessories",
      },
      {
        companyId: companyA._id,
        name: "Mouse Pad",
        description: "Desk accessory for daily work",
        price: 20,
        category: "Accessories",
      },
      {
        companyId: companyA._id,
        name: "Monitor 4K",
        description: "Sharp display for design reviews",
        price: 399,
        category: "Displays",
      },
      {
        companyId: companyB._id,
        name: "Keyboard Rival",
        description: "Private product from another tenant",
        price: 99,
        category: "Accessories",
      },
    ]);

    productSearchService = createProductSearchService({
      productRepository: createProductRepository(),
    });
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it("returns only products from the specified tenant", async () => {
    const results = await productSearchService.searchForCompany({
      companyId: companyAId,
      query: "",
      limit: 10,
    });

    expect(results).toHaveLength(3);
    expect(results.every((product) => product.name !== "Keyboard Rival")).toBe(true);
  });

  it("returns all tenant products when query is empty", async () => {
    const results = await productSearchService.searchForCompany({
      companyId: companyAId,
      limit: 10,
    });

    expect(results.map((product) => product.name).sort()).toEqual(["Keyboard Pro", "Monitor 4K", "Mouse Pad"]);
  });

  it("uses text search on product name and description", async () => {
    const byName = await productSearchService.searchForCompany({
      companyId: companyAId,
      query: "Keyboard",
      limit: 10,
    });
    const byDescription = await productSearchService.searchForCompany({
      companyId: companyAId,
      query: "design reviews",
      limit: 10,
    });

    expect(byName).toHaveLength(1);
    expect(byName[0].name).toBe("Keyboard Pro");
    expect(byDescription).toHaveLength(1);
    expect(byDescription[0].name).toBe("Monitor 4K");
  });

  it("applies category filtering inside the tenant scope", async () => {
    const results = await productSearchService.searchForCompany({
      companyId: companyAId,
      query: "",
      category: "Accessories",
      limit: 10,
    });

    expect(results).toHaveLength(2);
    expect(results.every((product) => product.category === "Accessories")).toBe(true);
  });

  it("respects the configured limit", async () => {
    const results = await productSearchService.searchForCompany({
      companyId: companyAId,
      query: "",
      limit: 2,
    });

    expect(results).toHaveLength(2);
  });

  it("supports ObjectId companyIds from repository-backed services", async () => {
    const results = await productSearchService.searchForCompany({
      companyId: new mongoose.Types.ObjectId(companyAId).toString(),
      query: "",
      limit: 10,
    });

    expect(results).toHaveLength(3);
  });
});
