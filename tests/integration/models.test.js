const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");

const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { Company, Conversation, Product, User } = require("../../src/models");

jest.setTimeout(120000);

describe("model indexes and persistence constraints", () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Promise.all([
      Company.syncIndexes(),
      User.syncIndexes(),
      Product.syncIndexes(),
      Conversation.syncIndexes(),
    ]);
  });

  afterEach(async () => {
    await Promise.all([
      Company.deleteMany({}),
      User.deleteMany({}),
      Product.deleteMany({}),
      Conversation.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it("rejects duplicate user emails at the database level", async () => {
    const company = await Company.create({ name: "Tenant A" });

    await User.create({
      companyId: company._id,
      name: "Admin",
      email: "duplicate@example.com",
      passwordHash: "hash-1",
      role: "admin",
    });

    await expect(
      User.create({
        companyId: company._id,
        name: "User",
        email: "duplicate@example.com",
        passwordHash: "hash-2",
        role: "user",
      })
    ).rejects.toMatchObject({
      code: 11000,
    });
  });

  it("rejects duplicate conversations for the same user", async () => {
    const companyId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    await Conversation.create({
      companyId,
      userId,
      messages: [],
    });

    await expect(
      Conversation.create({
        companyId,
        userId,
        messages: [],
      })
    ).rejects.toMatchObject({
      code: 11000,
    });
  });

  it("creates the User companyId index", async () => {
    const indexes = await User.collection.indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { companyId: 1 },
        }),
      ])
    );
  });

  it("creates the Product compound index for company and category", async () => {
    const indexes = await Product.collection.indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: { companyId: 1, category: 1 },
        }),
      ])
    );
  });

  it("creates the Product text index for name and description", async () => {
    const indexes = await Product.collection.indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: {
            _fts: "text",
            _ftsx: 1,
          },
          weights: {
            description: 1,
            name: 1,
          },
        }),
      ])
    );
  });

  it("generates createdAt and updatedAt timestamps automatically", async () => {
    const company = await Company.create({ name: "Timestamp Co" });
    const savedConversation = await Conversation.create({
      companyId: company._id,
      userId: new mongoose.Types.ObjectId(),
      messages: [
        {
          role: "user",
          content: "Hello",
        },
      ],
    });

    expect(savedConversation.createdAt).toBeInstanceOf(Date);
    expect(savedConversation.updatedAt).toBeInstanceOf(Date);
    expect(savedConversation.messages[0].createdAt).toBeInstanceOf(Date);
  });
});
