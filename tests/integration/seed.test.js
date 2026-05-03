const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { createApp } = require("../../src/app");
const { connectToDatabase, disconnectFromDatabase } = require("../../src/config/database");
const { createAuthenticate } = require("../../src/middleware/authenticate");
const { createLogger } = require("../../src/middleware/requestLogger");
const { requireAdmin } = require("../../src/middleware/requireAdmin");
const { Company, Product, User } = require("../../src/models");
const createUploadsRouter = require("../../src/routes/uploads");
const { loginUser, registerUser } = require("../../src/services/authService");
const { createJwtSigner, createJwtVerifier } = require("../../src/utils/jwt");
const { createPasswordHasher, createPasswordVerifier } = require("../../src/utils/password");
const { runSeed } = require("../../scripts/seed");

describe("seed integration flow", () => {
  let app;
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());

    const signToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "1h",
    });
    const verifyToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });
    const authenticate = createAuthenticate({ verifyToken });

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
          "/api/uploads",
          createUploadsRouter({
            authenticate,
            requireAdmin,
          })
        );
      },
    });
  });

  beforeEach(async () => {
    await Promise.all([Company.deleteMany({}), Product.deleteMany({}), User.deleteMany({})]);
  });

  afterAll(async () => {
    await disconnectFromDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it("creates demo tenants, users, products, and supports login", async () => {
    const summary = await runSeed({
      manageConnection: false,
      hashPassword: createPasswordHasher(4),
      logger: {
        info: jest.fn(),
      },
    });

    expect(summary).toMatchObject({
      companiesCreated: 2,
      usersCreated: 4,
      productsCreated: 20,
    });

    const companies = await Company.find({}).sort({ name: 1 }).lean();
    const users = await User.find({}).sort({ email: 1 }).lean();
    const products = await Product.find({}).lean();

    expect(companies).toHaveLength(2);
    expect(users).toHaveLength(4);
    expect(products).toHaveLength(20);

    const techCorp = companies.find((company) => company.name === "TechCorp");
    const retailCo = companies.find((company) => company.name === "RetailCo");

    expect(techCorp).toBeTruthy();
    expect(retailCo).toBeTruthy();

    const adminUsers = users.filter((user) => user.role === "admin");
    const regularUsers = users.filter((user) => user.role === "user");

    expect(adminUsers).toHaveLength(2);
    expect(regularUsers).toHaveLength(2);
    expect(users.every((user) => !["Admin123!", "User123!"].includes(user.passwordHash))).toBe(true);

    const techProducts = products.filter(
      (product) => product.companyId.toString() === techCorp._id.toString()
    );
    const retailProducts = products.filter(
      (product) => product.companyId.toString() === retailCo._id.toString()
    );

    expect(techProducts.length).toBeGreaterThanOrEqual(10);
    expect(retailProducts.length).toBeGreaterThanOrEqual(10);
    expect(new Set(techProducts.map((product) => product.category)).size).toBeGreaterThanOrEqual(2);
    expect(new Set(retailProducts.map((product) => product.category)).size).toBeGreaterThanOrEqual(2);
    expect(products.every((product) => typeof product.imagePath === "string")).toBe(true);
    expect(products.every((product) => !product.imageUrl)).toBe(true);
    expect(
      techProducts.every((product) =>
        product.imagePath.startsWith(`/api/uploads/products/${techCorp._id.toString()}/`)
      )
    ).toBe(true);
    expect(
      retailProducts.every((product) =>
        product.imagePath.startsWith(`/api/uploads/products/${retailCo._id.toString()}/`)
      )
    ).toBe(true);

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: "admin@techcorp.com",
      password: "Admin123!",
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user).toMatchObject({
      email: "admin@techcorp.com",
      role: "admin",
      companyId: techCorp._id.toString(),
    });
    expect(loginResponse.body.token).toEqual(expect.any(String));

    const imageResponse = await request(app)
      .get(techProducts[0].imagePath)
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers["content-type"]).toContain("image/png");
    expect(imageResponse.body.length).toBeGreaterThan(0);
  });

  it("is idempotent when re-run", async () => {
    await runSeed({
      manageConnection: false,
      hashPassword: createPasswordHasher(4),
      logger: {
        info: jest.fn(),
      },
    });

    await runSeed({
      manageConnection: false,
      hashPassword: createPasswordHasher(4),
      logger: {
        info: jest.fn(),
      },
    });

    const [companyCount, userCount, productCount] = await Promise.all([
      Company.countDocuments(),
      User.countDocuments(),
      Product.countDocuments(),
    ]);

    expect(companyCount).toBe(2);
    expect(userCount).toBe(4);
    expect(productCount).toBe(20);
  });
});
