const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { createApp } = require("../../src/app");
const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { createAuthenticate } = require("../../src/middleware/authenticate");
const { createLogger } = require("../../src/middleware/requestLogger");
const { requireAdmin } = require("../../src/middleware/requireAdmin");
const { Company, Product, User } = require("../../src/models");
const { createProductRepository } = require("../../src/repositories/productRepository");
const createProductsRouter = require("../../src/routes/products");
const { loginUser, registerUser } = require("../../src/services/authService");
const { createProductService } = require("../../src/services/productService");
const { createJwtSigner, createJwtVerifier } = require("../../src/utils/jwt");
const { createPasswordHasher, createPasswordVerifier } = require("../../src/utils/password");

describe("products integration flow", () => {
  let app;
  let mongoServer;
  let verifyToken;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Promise.all([Company.syncIndexes(), Product.syncIndexes(), User.syncIndexes()]);
  });

  beforeEach(async () => {
    await Promise.all([Company.deleteMany({}), Product.deleteMany({}), User.deleteMany({})]);

    const signToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "1h",
    });
    verifyToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });

    app = createApp({
      logger: createLogger("silent"),
      corsOrigin: "http://localhost:3000",
      getHealthStatus: () => ({
        status: "ok",
        database: "connected",
      }),
      authConfig: {
        registerUser,
        loginUser,
        hashPassword: createPasswordHasher(4),
        comparePassword: createPasswordVerifier(),
        signToken,
        verifyToken,
      },
      registerRoutes(currentApp) {
        currentApp.use(
          "/api/products",
          createProductsRouter({
            authenticate: createAuthenticate({ verifyToken }),
            requireAdmin,
            productService: createProductService({
              productRepository: createProductRepository(),
            }),
          })
        );
      },
    });
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  async function registerUserForCompany({ name, email, companyName }) {
    const response = await request(app).post("/api/auth/register").send({
      name,
      email,
      password: "password123",
      companyName,
    });

    return response.body.token;
  }

  it("returns 401 on GET /api/products without authentication", async () => {
    const response = await request(app).get("/api/products");

    expect(response.status).toBe(401);
  });

  it("returns only products from the authenticated tenant", async () => {
    const companyAToken = await registerUserForCompany({
      name: "Alice",
      email: "alice@example.com",
      companyName: "Company A",
    });
    await registerUserForCompany({
      name: "Bob",
      email: "bob@example.com",
      companyName: "Company B",
    });

    const companyAId = verifyToken(companyAToken).companyId;
    const companyB = await Company.findOne({ normalizedName: "company b" });

    await Product.create([
      {
        companyId: companyAId,
        name: "Tenant A Product",
        description: "Visible to company A",
        price: 50,
        category: "Hardware",
      },
      {
        companyId: companyB._id,
        name: "Tenant B Product",
        description: "Visible to company B",
        price: 75,
        category: "Hardware",
      },
    ]);

    const response = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${companyAToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe("Tenant A Product");
  });

  it("creates a product with companyId from AuthContext", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });
    const auth = verifyToken(adminToken);

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        companyId: "507f1f77bcf86cd799439011",
        name: "Keyboard",
        description: "Mechanical keyboard",
        price: 120,
        category: "Accessories",
      });

    expect(response.status).toBe(201);
    expect(response.body.companyId).toBe(auth.companyId);

    const savedProduct = await Product.findById(response.body._id).lean();
    expect(savedProduct.companyId.toString()).toBe(auth.companyId);
  });

  it("creates a product with imagePath from the upload flow", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin-path@example.com",
      companyName: "Acme",
    });
    const auth = verifyToken(adminToken);

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Keyboard",
        description: "Mechanical keyboard",
        price: 120,
        category: "Accessories",
        imagePath: `/api/uploads/products/${auth.companyId}/keyboard.png`,
      });

    expect(response.status).toBe(201);
    expect(response.body.imagePath).toBe(`/api/uploads/products/${auth.companyId}/keyboard.png`);

    const savedProduct = await Product.findById(response.body._id).lean();
    expect(savedProduct.imagePath).toBe(`/api/uploads/products/${auth.companyId}/keyboard.png`);
  });

  it("returns 403 on POST /api/products for non-admin users", async () => {
    await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });
    const userToken = await registerUserForCompany({
      name: "User",
      email: "user@example.com",
      companyName: "Acme",
    });

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "Keyboard",
        description: "Mechanical keyboard",
        price: 120,
        category: "Accessories",
      });

    expect(response.status).toBe(403);
  });

  it("returns 400 on POST /api/products for invalid data", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });

    const response = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Keyboard",
        description: "",
        price: 0,
        category: "",
      });

    expect(response.status).toBe(400);
  });

  it("updates a product in the authenticated tenant", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });
    const { companyId } = verifyToken(adminToken);
    const product = await Product.create({
      companyId,
      name: "Keyboard",
      description: "Mechanical keyboard",
      price: 120,
      category: "Accessories",
    });

    const response = await request(app)
      .put(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Keyboard Pro",
        description: "Updated mechanical keyboard",
        price: 150,
        category: "Accessories",
      });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe("Keyboard Pro");
  });

  it("updates a product imagePath in the authenticated tenant", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin-update-path@example.com",
      companyName: "Acme",
    });
    const { companyId } = verifyToken(adminToken);
    const product = await Product.create({
      companyId,
      name: "Keyboard",
      description: "Mechanical keyboard",
      price: 120,
      category: "Accessories",
      imageUrl: "https://example.com/legacy.png",
    });

    const response = await request(app)
      .put(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Keyboard Pro",
        description: "Updated mechanical keyboard",
        price: 150,
        category: "Accessories",
        imagePath: `/api/uploads/products/${companyId}/keyboard-pro.png`,
      });

    expect(response.status).toBe(200);
    expect(response.body.imagePath).toBe(`/api/uploads/products/${companyId}/keyboard-pro.png`);
    expect(response.body.imageUrl).toBeUndefined();
  });

  it("returns 404 when updating a product from another tenant", async () => {
    const companyAToken = await registerUserForCompany({
      name: "Admin A",
      email: "admin-a@example.com",
      companyName: "Company A",
    });
    const companyBToken = await registerUserForCompany({
      name: "Admin B",
      email: "admin-b@example.com",
      companyName: "Company B",
    });
    const { companyId: companyBId } = verifyToken(companyBToken);
    const product = await Product.create({
      companyId: companyBId,
      name: "Tenant B Product",
      description: "Private",
      price: 99,
      category: "Hardware",
    });

    const response = await request(app)
      .put(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${companyAToken}`)
      .send({
        name: "Edited",
        description: "Edited",
        price: 100,
        category: "Hardware",
      });

    expect(response.status).toBe(404);
  });

  it("returns 403 when a user role updates a product", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });
    const userToken = await registerUserForCompany({
      name: "User",
      email: "user@example.com",
      companyName: "Acme",
    });
    const { companyId } = verifyToken(adminToken);
    const product = await Product.create({
      companyId,
      name: "Keyboard",
      description: "Mechanical keyboard",
      price: 120,
      category: "Accessories",
    });

    const response = await request(app)
      .put(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        name: "Edited",
        description: "Edited",
        price: 100,
        category: "Hardware",
      });

    expect(response.status).toBe(403);
  });

  it("deletes a product in the authenticated tenant", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });
    const { companyId } = verifyToken(adminToken);
    const product = await Product.create({
      companyId,
      name: "Keyboard",
      description: "Mechanical keyboard",
      price: 120,
      category: "Accessories",
    });

    const response = await request(app)
      .delete(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(204);

    const deletedProduct = await Product.findById(product._id);
    expect(deletedProduct).toBeNull();
  });

  it("returns 404 when deleting a product from another tenant", async () => {
    const companyAToken = await registerUserForCompany({
      name: "Admin A",
      email: "admin-a@example.com",
      companyName: "Company A",
    });
    const companyBToken = await registerUserForCompany({
      name: "Admin B",
      email: "admin-b@example.com",
      companyName: "Company B",
    });
    const { companyId: companyBId } = verifyToken(companyBToken);
    const product = await Product.create({
      companyId: companyBId,
      name: "Tenant B Product",
      description: "Private",
      price: 99,
      category: "Hardware",
    });

    const response = await request(app)
      .delete(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${companyAToken}`);

    expect(response.status).toBe(404);
  });

  it("returns 403 when a user role deletes a product", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });
    const userToken = await registerUserForCompany({
      name: "User",
      email: "user@example.com",
      companyName: "Acme",
    });
    const { companyId } = verifyToken(adminToken);
    const product = await Product.create({
      companyId,
      name: "Keyboard",
      description: "Mechanical keyboard",
      price: 120,
      category: "Accessories",
    });

    const response = await request(app)
      .delete(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${userToken}`);

    expect(response.status).toBe(403);
  });

  it("returns legacy imageUrl products and new imagePath products", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin-list-path@example.com",
      companyName: "Acme",
    });
    const { companyId } = verifyToken(adminToken);

    await Product.create([
      {
        companyId,
        name: "Legacy Product",
        description: "Uses URL",
        price: 50,
        category: "Hardware",
        imageUrl: "https://example.com/legacy.png",
      },
      {
        companyId,
        name: "Uploaded Product",
        description: "Uses upload path",
        price: 60,
        category: "Hardware",
        imagePath: `/api/uploads/products/${companyId}/uploaded.png`,
      },
    ]);

    const response = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Legacy Product",
          imageUrl: "https://example.com/legacy.png",
        }),
        expect.objectContaining({
          name: "Uploaded Product",
          imagePath: `/api/uploads/products/${companyId}/uploaded.png`,
        }),
      ])
    );
  });
});
