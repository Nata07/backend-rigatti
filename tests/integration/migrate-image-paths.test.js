const { MongoMemoryServer } = require("mongodb-memory-server");

const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { Product } = require("../../src/models");
const { migrateImagePaths } = require("../../scripts/migrate-image-paths.ts");

describe("image path migration integration", () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Product.syncIndexes();
  });

  beforeEach(async () => {
    await Product.deleteMany({});
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it("converts legacy upload imageUrl values into imagePath", async () => {
    const product = await Product.create({
      companyId: "507f1f77bcf86cd799439011",
      name: "Keyboard",
      description: "Mechanical keyboard",
      price: 120,
      category: "Accessories",
      imageUrl: "http://localhost:3001/uploads/products/company-123/keyboard.png",
    });

    const stats = await migrateImagePaths();
    const migrated = await Product.findById(product._id).lean();

    expect(stats).toEqual({
      scanned: 1,
      migrated: 1,
      skipped: 0,
    });
    expect(migrated.imageUrl).toBe("http://localhost:3001/uploads/products/company-123/keyboard.png");
    expect(migrated.imagePath).toBe("/api/uploads/products/company-123/keyboard.png");
  });

  it("skips legacy imageUrl values that cannot be mapped to local uploads", async () => {
    await Product.create({
      companyId: "507f1f77bcf86cd799439011",
      name: "Keyboard",
      description: "Mechanical keyboard",
      price: 120,
      category: "Accessories",
      imageUrl: "https://example.com/keyboard.png",
    });

    const stats = await migrateImagePaths();
    const unchanged = await Product.findOne({ name: "Keyboard" }).lean();

    expect(stats).toEqual({
      scanned: 1,
      migrated: 0,
      skipped: 1,
    });
    expect(unchanged.imagePath).toBeUndefined();
  });
});
