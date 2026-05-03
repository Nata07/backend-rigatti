const mongoose = require("mongoose");

const {
  Company,
  Conversation,
  MessageRole,
  Product,
  User,
  UserRole,
} = require("../../src/models");

describe("model schema validations", () => {
  const companyId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  it("validates Company required fields", async () => {
    const company = new Company({});

    await expect(company.validate()).rejects.toThrow();
    expect(company.validateSync().errors.name).toBeDefined();
  });

  it("validates User required fields", async () => {
    const user = new User({});
    const error = user.validateSync();

    expect(error.errors.companyId).toBeDefined();
    expect(error.errors.name).toBeDefined();
    expect(error.errors.email).toBeDefined();
    expect(error.errors.passwordHash).toBeDefined();
    expect(error.errors.role).toBeDefined();
  });

  it("defaults new users to unverified", () => {
    const user = new User({
      companyId,
      name: "New User",
      email: "new@example.com",
      passwordHash: "hashed-password",
      role: UserRole.User,
    });

    expect(user.verified).toBe(false);
    expect(user.validateSync()).toBeUndefined();
  });

  it("rejects invalid User role values", () => {
    const user = new User({
      companyId,
      name: "Test User",
      email: "user@example.com",
      passwordHash: "hashed-password",
      role: "manager",
    });

    const error = user.validateSync();

    expect(error.errors.role).toBeDefined();
  });

  it("exports the fixed role enums for typed schemas", () => {
    expect(UserRole).toEqual({
      Admin: "admin",
      User: "user",
    });
    expect(MessageRole).toEqual({
      User: "user",
      Assistant: "assistant",
    });
  });

  it("validates Product required fields", () => {
    const product = new Product({});
    const error = product.validateSync();

    expect(error.errors.companyId).toBeDefined();
    expect(error.errors.name).toBeDefined();
    expect(error.errors.description).toBeDefined();
    expect(error.errors.price).toBeDefined();
    expect(error.errors.category).toBeDefined();
  });

  it("validates Product price as a positive number", () => {
    const product = new Product({
      companyId,
      name: "Product",
      description: "Description",
      price: 0,
      category: "Category",
    });

    const error = product.validateSync();

    expect(error.errors.price).toBeDefined();
  });

  it("accepts Product imagePath while keeping imageUrl optional", () => {
    const withImagePath = new Product({
      companyId,
      name: "Product",
      description: "Description",
      price: 10,
      category: "Category",
      imagePath: "/api/uploads/products/company-123/product.png",
    });
    const withImageUrl = new Product({
      companyId,
      name: "Legacy Product",
      description: "Description",
      price: 10,
      category: "Category",
      imageUrl: "https://example.com/product.png",
    });

    expect(withImagePath.validateSync()).toBeUndefined();
    expect(withImageUrl.validateSync()).toBeUndefined();
  });

  it("validates Conversation required fields", () => {
    const conversation = new Conversation({});
    const error = conversation.validateSync();

    expect(error.errors.companyId).toBeDefined();
    expect(error.errors.userId).toBeDefined();
  });

  it("validates Message role as user or assistant", () => {
    const conversation = new Conversation({
      companyId,
      userId,
      messages: [
        {
          role: "tool",
          content: "invalid role",
        },
      ],
    });

    const error = conversation.validateSync();

    expect(error.errors["messages.0.role"]).toBeDefined();
  });

  it("keeps ObjectId references and timestamps on typed documents", () => {
    const user = new User({
      companyId,
      name: "Typed User",
      email: "typed@example.com",
      passwordHash: "hashed-password",
      role: UserRole.Admin,
    });
    const conversation = new Conversation({
      companyId,
      userId,
      messages: [
        {
          role: MessageRole.User,
          content: "Hello",
        },
      ],
    });

    expect(user.companyId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(Object.prototype.toString.call(conversation.messages[0].createdAt)).toBe(
      "[object Date]"
    );
  });
});
