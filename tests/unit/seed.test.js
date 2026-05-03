const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const ts = require("typescript");

const { Company } = require("../../src/models");
const { createPasswordHasher, createPasswordVerifier } = require("../../src/utils/password");
const {
  createCompanyInput,
  createProductInput,
  createUserInput,
  ensureTenantImageAssets,
} = require("../../scripts/seed");
const { seedCompanies, validateSeedData } = require("../../scripts/seedData");

describe("seed helpers", () => {
  it("creates a valid company payload", () => {
    const payload = createCompanyInput({
      name: "  TechCorp  ",
    });

    const company = new Company(payload);
    const validationError = company.validateSync();

    expect(validationError).toBeUndefined();
    expect(payload).toEqual({
      name: "TechCorp",
      normalizedName: "techcorp",
    });
  });

  it("hashes seeded users with the password utility", async () => {
    const hashPassword = createPasswordHasher(4);
    const comparePassword = createPasswordVerifier();
    const companyId = new mongoose.Types.ObjectId();

    const payload = await createUserInput({
      companyId,
      user: {
        name: "Tech User",
        email: "USER@TECHCORP.COM",
        password: "User123!",
        role: "user",
      },
      hashPassword,
    });

    expect(payload.email).toBe("user@techcorp.com");
    expect(payload.passwordHash).not.toBe("User123!");
    await expect(comparePassword("User123!", payload.passwordHash)).resolves.toBe(true);
  });

  it("validates product required fields", () => {
    expect(() =>
      createProductInput({
        companyId: new mongoose.Types.ObjectId(),
        product: {
          name: "Keyboard",
          description: "",
          price: 120,
          category: "Accessories",
        },
      })
    ).toThrow();
  });

  it("includes optional product imagePath when provided", () => {
    const payload = createProductInput({
      companyId: new mongoose.Types.ObjectId(),
      product: {
        name: "Keyboard",
        description: "Mechanical keyboard",
        price: 120,
        category: "Accessories",
        sampleImageFile: "tech-accessory.png",
      },
      imagePath: " /api/uploads/products/company-1/keyboard.png ",
    });

    expect(payload.imagePath).toBe("/api/uploads/products/company-1/keyboard.png");
  });

  it("keeps at least 10 products per company in the dataset", () => {
    const companies = validateSeedData(seedCompanies);

    expect(companies).toHaveLength(2);
    expect(companies.every((company) => company.products.length >= 10)).toBe(true);
    expect(
      companies.every((company) =>
        company.products.every((product) => typeof product.sampleImageFile === "string")
      )
    ).toBe(true);
  });

  it("rejects invalid company payloads", () => {
    expect(() => createCompanyInput({ name: "   " })).toThrow();
  });

  it("rejects invalid user roles", async () => {
    await expect(
      createUserInput({
        companyId: new mongoose.Types.ObjectId(),
        user: {
          name: "Wrong Role",
          email: "wrong@example.com",
          password: "User123!",
          role: "manager",
        },
        hashPassword: async () => "hashed-password",
      })
    ).rejects.toThrow();
  });

  it("rejects seed execution without mongoUri when connection management is enabled", async () => {
    const { runSeed } = require("../../scripts/seed");

    await expect(
      runSeed({
        logger: {
          info: jest.fn(),
        },
      })
    ).rejects.toThrow("mongoUri is required when manageConnection is enabled");
  });

  it("rejects datasets without exactly two companies", () => {
    expect(() => validateSeedData([seedCompanies[0]])).toThrow(
      "Seed dataset must define exactly 2 companies"
    );
  });

  it("rejects datasets with duplicate company names", () => {
    expect(() =>
      validateSeedData([
        seedCompanies[0],
        {
          ...seedCompanies[1],
          name: "techcorp",
        },
      ])
    ).toThrow("Seed company names must be distinct: techcorp");
  });

  it("rejects datasets without both admin and user roles", () => {
    expect(() =>
      validateSeedData([
        {
          ...seedCompanies[0],
          users: [seedCompanies[0].users[0]],
        },
        seedCompanies[1],
      ])
    ).toThrow("Seed company must define at least 2 users: TechCorp");

    expect(() =>
      validateSeedData([
        {
          ...seedCompanies[0],
          users: [
            seedCompanies[0].users[0],
            {
              ...seedCompanies[0].users[1],
              role: "admin",
            },
          ],
        },
        seedCompanies[1],
      ])
    ).toThrow("Seed company must include admin and user roles: TechCorp");
  });

  it("rejects datasets without enough products or category variety", () => {
    expect(() =>
      validateSeedData([
        {
          ...seedCompanies[0],
          products: seedCompanies[0].products.slice(0, 9),
        },
        seedCompanies[1],
      ])
    ).toThrow("Seed company must define at least 10 products: TechCorp");

    expect(() =>
      validateSeedData([
        {
          ...seedCompanies[0],
          products: seedCompanies[0].products.map((product) => ({
            ...product,
            category: "Accessories",
          })),
        },
        seedCompanies[1],
      ])
    ).toThrow("Seed company must include varied product categories: TechCorp");
  });

  it("copies sample images into the tenant uploads directory and returns image paths", async () => {
    const companyId = "507f1f77bcf86cd799439011";
    const assets = await ensureTenantImageAssets(companyId, seedCompanies[0].products);
    const asset = assets.get("tech-workstation.png");

    expect(asset).toMatchObject({
      filename: "tech-workstation.png",
      imagePath: `/api/uploads/products/${companyId}/tech-workstation.png`,
    });

    const copiedFile = path.resolve(
      __dirname,
      "../../uploads/products",
      companyId,
      "tech-workstation.png"
    );

    expect(fs.existsSync(copiedFile)).toBe(true);
  });

  it("type-checks the TypeScript seed scripts without diagnostics", () => {
    const backendRoot = path.resolve(__dirname, "../..");
    const tsconfigPath = path.join(backendRoot, "tsconfig.json");
    const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, backendRoot);
    const compilerOptions = {
      ...parsed.options,
      noEmit: true,
      rootDir: backendRoot,
      allowJs: true,
    };
    const program = ts.createProgram({
      rootNames: [
        path.join(backendRoot, "scripts/seed.ts"),
        path.join(backendRoot, "scripts/seedData.ts"),
      ],
      options: compilerOptions,
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

    if (diagnostics.length > 0) {
      const host = {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => backendRoot,
        getNewLine: () => "\n",
      };
      throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
    }
  });
});
