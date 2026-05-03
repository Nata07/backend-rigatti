const fs = require("fs");
const path = require("path");

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
const createUploadsRouter = require("../../src/routes/uploads");
const { loginUser, registerUser } = require("../../src/services/authService");
const { createProductService } = require("../../src/services/productService");
const { createJwtSigner, createJwtVerifier } = require("../../src/utils/jwt");
const { createPasswordHasher, createPasswordVerifier } = require("../../src/utils/password");

describe("uploads integration flow", () => {
  const uploadsRoot = path.resolve(__dirname, "../../uploads");
  const productUploadsRoot = path.join(uploadsRoot, "products");
  const imageBytes = Buffer.from("fake-image-binary");
  let app;
  let mongoServer;
  let verifyToken;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectToDatabase(mongoServer.getUri());
    await Promise.all([Company.syncIndexes(), Product.syncIndexes(), User.syncIndexes()]);
  });

  beforeEach(async () => {
    fs.rmSync(productUploadsRoot, { recursive: true, force: true });
    fs.mkdirSync(uploadsRoot, { recursive: true });

    await Promise.all([Company.deleteMany({}), Product.deleteMany({}), User.deleteMany({})]);

    const signToken = createJwtSigner({
      secret: "super-secret-key-for-tests-with-32-chars",
      expiresIn: "1h",
    });
    verifyToken = createJwtVerifier({
      secret: "super-secret-key-for-tests-with-32-chars",
    });

    const authenticate = createAuthenticate({ verifyToken });
    const productService = createProductService({
      productRepository: createProductRepository(),
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
            authenticate,
            requireAdmin,
            productService,
          })
        );
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

  afterAll(async () => {
    fs.rmSync(productUploadsRoot, { recursive: true, force: true });
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

  it("uploads a valid product image and returns an imagePath", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });
    const { companyId } = verifyToken(adminToken);

    const response = await request(app)
      .post("/api/uploads/product-image")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("image", imageBytes, {
        filename: "product.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(200);
    expect(response.body.imagePath).toMatch(
      new RegExp(`^/api/uploads/products/${companyId}/[0-9a-f-]+\\.png$`)
    );
    expect(response.body.size).toBe(imageBytes.length);

    const storedFile = path.join(uploadsRoot, "products", companyId, response.body.filename);
    expect(fs.existsSync(storedFile)).toBe(true);
  });

  it("requires authentication for uploads", async () => {
    const response = await request(app).post("/api/uploads/product-image").attach("image", imageBytes, {
      filename: "product.png",
      contentType: "image/png",
    });

    expect(response.status).toBe(401);
  });

  it("requires an admin role for uploads", async () => {
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
      .post("/api/uploads/product-image")
      .set("Authorization", `Bearer ${userToken}`)
      .attach("image", imageBytes, {
        filename: "product.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(403);
  });

  it("rejects files larger than 5MB", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });

    const response = await request(app)
      .post("/api/uploads/product-image")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("image", Buffer.alloc(5 * 1024 * 1024 + 1), {
        filename: "large.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("File too large");
  });

  it("rejects invalid file types", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });

    const response = await request(app)
      .post("/api/uploads/product-image")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("image", Buffer.from("gif"), {
        filename: "animated.gif",
        contentType: "image/gif",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Invalid file type");
  });

  it("serves uploaded images for the authenticated tenant", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });

    const uploadResponse = await request(app)
      .post("/api/uploads/product-image")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("image", imageBytes, {
        filename: "product.webp",
        contentType: "image/webp",
      });

    const imageResponse = await request(app)
      .get(uploadResponse.body.imagePath)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers["content-type"]).toContain("image/webp");
    expect(Buffer.compare(imageResponse.body, imageBytes)).toBe(0);
  });

  it("returns 404 for cross-tenant image access", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin A",
      email: "admin-a@example.com",
      companyName: "Company A",
    });
    const otherTenantToken = await registerUserForCompany({
      name: "Admin B",
      email: "admin-b@example.com",
      companyName: "Company B",
    });

    const uploadResponse = await request(app)
      .post("/api/uploads/product-image")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("image", imageBytes, {
        filename: "product.jpg",
        contentType: "image/jpeg",
      });

    const imageResponse = await request(app)
      .get(uploadResponse.body.imagePath)
      .set("Authorization", `Bearer ${otherTenantToken}`);

    expect(imageResponse.status).toBe(404);
    expect(imageResponse.body.error.message).toBe("Image not found");
  });

  it("removes the uploaded image when the product is deleted", async () => {
    const adminToken = await registerUserForCompany({
      name: "Admin",
      email: "admin@example.com",
      companyName: "Acme",
    });
    const { companyId } = verifyToken(adminToken);

    const uploadResponse = await request(app)
      .post("/api/uploads/product-image")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("image", imageBytes, {
        filename: "product.png",
        contentType: "image/png",
      });

    const product = await Product.create({
      companyId,
      name: "Keyboard",
      description: "Mechanical keyboard",
      price: 120,
      category: "Accessories",
      imagePath: uploadResponse.body.imagePath,
    });

    const storedFile = path.join(uploadsRoot, "products", companyId, uploadResponse.body.filename);
    expect(fs.existsSync(storedFile)).toBe(true);

    const response = await request(app)
      .delete(`/api/products/${product._id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(204);
    expect(fs.existsSync(storedFile)).toBe(false);
  });
});
