import mongoose from "mongoose";

import { connectToDatabase, disconnectFromDatabase } from "../src/config/database";
import { Product } from "../src/models";

interface MigrationStats {
  scanned: number;
  migrated: number;
  skipped: number;
}

export function deriveImagePathFromUrl(imageUrl: string): string | null {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    return null;
  }

  const pathname = parsedUrl.pathname;
  const uploadsIndex = pathname.indexOf("/uploads/products/");

  if (uploadsIndex === -1) {
    return null;
  }

  const derivedPath = pathname.slice(uploadsIndex);
  if (!/^\/uploads\/products\/[^/]+\/[^/]+$/.test(derivedPath)) {
    return null;
  }

  return `/api${derivedPath}`;
}

export async function migrateImagePaths(): Promise<MigrationStats> {
  const products = await Product.find(
    {
      imageUrl: { $type: "string", $ne: "" },
      $or: [{ imagePath: { $exists: false } }, { imagePath: null }, { imagePath: "" }],
    },
    {
      _id: 1,
      imageUrl: 1,
    },
  );

  const stats: MigrationStats = {
    scanned: products.length,
    migrated: 0,
    skipped: 0,
  };

  for (const product of products) {
    const imageUrl = typeof product.imageUrl === "string" ? product.imageUrl.trim() : "";
    const imagePath = deriveImagePathFromUrl(imageUrl);

    if (!imagePath) {
      stats.skipped += 1;
      continue;
    }

    await Product.updateOne({ _id: product._id }, { $set: { imagePath } });
    stats.migrated += 1;
  }

  return stats;
}

export async function runMigration(mongoUri: string): Promise<MigrationStats> {
  await connectToDatabase(mongoUri);

  try {
    await Product.syncIndexes();
    return await migrateImagePaths();
  } finally {
    await disconnectFromDatabase();
  }
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }

  const stats = await runMigration(mongoUri);
  // eslint-disable-next-line no-console
  console.log(
    `Image path migration complete: scanned=${stats.scanned}, migrated=${stats.migrated}, skipped=${stats.skipped}`,
  );
}

if (require.main === module) {
  void main()
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error("Image path migration failed", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) {
        await disconnectFromDatabase();
      }
    });
}
