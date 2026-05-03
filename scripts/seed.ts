import fs from "fs/promises";
import path from "path";

import { loadEnv } from "../src/config/env";
import { connectToDatabase, disconnectFromDatabase } from "../src/config/database";
import { Company, Product, User } from "../src/models";
import { createPasswordHasher } from "../src/utils/password";
import {
  seedCompanies,
  validateSeedData,
  type SeedCompany,
  type SeedProduct,
  type SeedUser,
} from "./seedData";

interface CompanyInput {
  name: string;
  normalizedName: string;
}

interface UserInput {
  companyId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: SeedUser["role"];
  verified: boolean;
}

interface ProductInput {
  companyId: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imagePath?: string;
}

interface SeedTenantSummary {
  companyId: string;
  companyName: string;
  usersCreated: number;
  productsCreated: number;
}

interface SeedSummary {
  companiesCreated: number;
  usersCreated: number;
  productsCreated: number;
  tenants: SeedTenantSummary[];
}

interface SeedLogger {
  info: (message: string) => void;
}

interface RunSeedOptions {
  seedCompanies?: SeedCompany[];
  logger?: SeedLogger;
  hashPassword?: (password: string) => Promise<string>;
  saltRounds?: number;
  manageConnection?: boolean;
  mongoUri?: string;
}

interface SeedAsset {
  filename: string;
  imagePath: string;
}

const sampleUploadsRoot = path.resolve(__dirname, "../uploads/samples");
const tenantUploadsRoot = path.resolve(__dirname, "../uploads/products");

function buildProductImagePath(companyId: string, filename: string): string {
  return `/api/uploads/products/${companyId}/${filename}`;
}

function normalizeSampleFilename(filename: string): string {
  return path.basename(filename).trim();
}

function createCompanyInput(company: Pick<SeedCompany, "name">): CompanyInput {
  const normalizedName = company.name.trim().toLowerCase();
  const payload: CompanyInput = {
    name: company.name.trim(),
    normalizedName,
  };

  const validationError = new Company(payload).validateSync();

  if (validationError) {
    throw validationError;
  }

  return payload;
}

async function createUserInput({
  companyId,
  user,
  hashPassword,
}: {
  companyId: string;
  user: SeedUser;
  hashPassword: (password: string) => Promise<string>;
}): Promise<UserInput> {
  const payload: UserInput = {
    companyId,
    name: user.name.trim(),
    email: user.email.trim().toLowerCase(),
    passwordHash: await hashPassword(user.password),
    role: user.role,
    verified: true,
  };

  const validationError = new User(payload).validateSync();

  if (validationError) {
    throw validationError;
  }

  return payload;
}

async function ensureTenantImageAssets(
  companyId: string,
  products: SeedProduct[],
): Promise<Map<string, SeedAsset>> {
  const uniqueSampleFiles = Array.from(
    new Set(products.map((product) => normalizeSampleFilename(product.sampleImageFile))),
  );
  const assets = new Map<string, SeedAsset>();
  const destinationRoot = path.join(tenantUploadsRoot, companyId);

  await fs.mkdir(destinationRoot, { recursive: true });

  for (const sampleFilename of uniqueSampleFiles) {
    const sourcePath = path.join(sampleUploadsRoot, sampleFilename);
    const destinationPath = path.join(destinationRoot, sampleFilename);

    await fs.copyFile(sourcePath, destinationPath);

    assets.set(sampleFilename, {
      filename: sampleFilename,
      imagePath: buildProductImagePath(companyId, sampleFilename),
    });
  }

  return assets;
}

function createProductInput({
  companyId,
  product,
  imagePath,
}: {
  companyId: string;
  product: SeedProduct;
  imagePath?: string;
}): ProductInput {
  const payload: ProductInput = {
    companyId,
    name: product.name.trim(),
    description: product.description.trim(),
    price: product.price,
    category: product.category.trim(),
  };

  if (imagePath) {
    payload.imagePath = imagePath.trim();
  }

  const validationError = new Product(payload).validateSync();

  if (validationError) {
    throw validationError;
  }

  return payload;
}

async function seedTenant({
  company,
  hashPassword,
  logger,
}: {
  company: SeedCompany;
  hashPassword: (password: string) => Promise<string>;
  logger: SeedLogger;
}): Promise<SeedTenantSummary> {
  const companyInput = createCompanyInput(company);
  await Company.updateOne({ normalizedName: companyInput.normalizedName }, companyInput, { upsert: true });

  const savedCompany = await Company.findOne({
    normalizedName: companyInput.normalizedName,
  });

  if (!savedCompany) {
    throw new Error(`Failed to seed company ${companyInput.name}`);
  }

  logger.info(`Seeded company ${savedCompany.name}`);

  for (const user of company.users) {
    const userInput = await createUserInput({
      companyId: savedCompany._id.toString(),
      user,
      hashPassword,
    });

    await User.updateOne({ email: userInput.email }, userInput, { upsert: true });
    logger.info(`Seeded user ${userInput.email}`);
  }

  const tenantImageAssets = await ensureTenantImageAssets(savedCompany._id.toString(), company.products);
  const productInputs = company.products.map((product) => {
    const sampleImageFile = normalizeSampleFilename(product.sampleImageFile);
    const asset = tenantImageAssets.get(sampleImageFile);

    if (!asset) {
      throw new Error(`Missing seeded asset mapping for ${sampleImageFile}`);
    }

    return createProductInput({
      companyId: savedCompany._id.toString(),
      product,
      imagePath: asset.imagePath,
    });
  });

  await Product.deleteMany({ companyId: savedCompany._id });
  await Product.insertMany(productInputs);
  logger.info(`Seeded ${productInputs.length} products for ${savedCompany.name}`);

  return {
    companyId: savedCompany._id.toString(),
    companyName: savedCompany.name,
    usersCreated: company.users.length,
    productsCreated: productInputs.length,
  };
}

async function runSeed(options: RunSeedOptions = {}): Promise<SeedSummary> {
  const companies = validateSeedData(options.seedCompanies ?? seedCompanies);
  const logger = options.logger ?? console;
  const hashPassword =
    options.hashPassword ?? createPasswordHasher(options.saltRounds ?? 10);
  const shouldManageConnection = options.manageConnection !== false;

  if (shouldManageConnection) {
    if (!options.mongoUri) {
      throw new Error("mongoUri is required when manageConnection is enabled");
    }

    await connectToDatabase(options.mongoUri);
  }

  try {
    await Promise.all([Company.syncIndexes(), User.syncIndexes(), Product.syncIndexes()]);

    const seededTenants: SeedTenantSummary[] = [];

    for (const company of companies) {
      seededTenants.push(
        await seedTenant({
          company,
          hashPassword,
          logger,
        }),
      );
    }

    const summary: SeedSummary = {
      companiesCreated: seededTenants.length,
      usersCreated: seededTenants.reduce((total, tenant) => total + tenant.usersCreated, 0),
      productsCreated: seededTenants.reduce((total, tenant) => total + tenant.productsCreated, 0),
      tenants: seededTenants,
    };

    logger.info(
      `Seed completed: ${summary.companiesCreated} companies, ${summary.usersCreated} users, ${summary.productsCreated} products`,
    );

    return summary;
  } finally {
    if (shouldManageConnection) {
      await disconnectFromDatabase();
    }
  }
}

async function main(): Promise<void> {
  const env = loadEnv();

  await runSeed({
    mongoUri: env.MONGODB_URI,
    saltRounds: env.BCRYPT_SALT_ROUNDS,
  });
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("Seed failed", error);
    process.exit(1);
  });
}

export {
  buildProductImagePath,
  createCompanyInput,
  createProductInput,
  createUserInput,
  ensureTenantImageAssets,
  main,
  runSeed,
  seedTenant,
};
