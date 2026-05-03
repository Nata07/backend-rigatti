export interface SeedUser {
  name: string;
  email: string;
  password: string;
  role: "admin" | "user";
}

export interface SeedProduct {
  name: string;
  description: string;
  price: number;
  category: string;
  sampleImageFile: string;
}

export interface SeedCompany {
  name: string;
  users: SeedUser[];
  products: SeedProduct[];
}

const techImageFiles = {
  workstation: "tech-workstation.png",
  mobile: "tech-mobile.png",
  accessory: "tech-accessory.png",
  storage: "tech-storage.png",
} as const;

const retailImageFiles = {
  apparel: "retail-apparel.png",
  footwear: "retail-footwear.png",
  accessory: "retail-accessory.png",
  bag: "retail-bag.png",
} as const;

const seedCompanies: SeedCompany[] = [
  {
    name: "TechCorp",
    users: [
      {
        name: "TechCorp Admin",
        email: "admin@techcorp.com",
        password: "Admin123!",
        role: "admin",
      },
      {
        name: "TechCorp User",
        email: "user@techcorp.com",
        password: "User123!",
        role: "user",
      },
    ],
    products: [
      {
        name: "QuantumBook Pro 14",
        description: "High-performance laptop for engineering teams and hybrid work.",
        price: 1499.99,
        category: "Electronics",
        sampleImageFile: techImageFiles.workstation,
      },
      {
        name: "NovaPhone X",
        description: "5G smartphone with OLED display and all-day battery life.",
        price: 999.9,
        category: "Electronics",
        sampleImageFile: techImageFiles.mobile,
      },
      {
        name: "OrbitTab 11",
        description: "Portable tablet designed for field teams and presentations.",
        price: 649.5,
        category: "Electronics",
        sampleImageFile: techImageFiles.mobile,
      },
      {
        name: "VisionView 27",
        description: "27-inch 4K monitor with accurate color reproduction.",
        price: 419,
        category: "Electronics",
        sampleImageFile: techImageFiles.workstation,
      },
      {
        name: "PulseKeys Mechanical Keyboard",
        description: "Mechanical keyboard with tactile switches and compact layout.",
        price: 139.9,
        category: "Accessories",
        sampleImageFile: techImageFiles.accessory,
      },
      {
        name: "GlideMouse Wireless",
        description: "Ergonomic wireless mouse for long office sessions.",
        price: 59.9,
        category: "Accessories",
        sampleImageFile: techImageFiles.accessory,
      },
      {
        name: "EchoBuds Pro",
        description: "Noise-cancelling earbuds for calls and focused work.",
        price: 189.75,
        category: "Audio",
        sampleImageFile: techImageFiles.accessory,
      },
      {
        name: "ClearCam HD",
        description: "1080p webcam with low-light optimization for video meetings.",
        price: 89.5,
        category: "Accessories",
        sampleImageFile: techImageFiles.accessory,
      },
      {
        name: "FlashCore 1TB SSD",
        description: "External SSD with fast read speeds for creative workloads.",
        price: 159,
        category: "Storage",
        sampleImageFile: techImageFiles.storage,
      },
      {
        name: "SwiftDrive 256GB",
        description: "Compact USB drive for quick file transfers and backups.",
        price: 29.99,
        category: "Storage",
        sampleImageFile: techImageFiles.storage,
      },
    ],
  },
  {
    name: "RetailCo",
    users: [
      {
        name: "RetailCo Admin",
        email: "admin@retailco.com",
        password: "Admin123!",
        role: "admin",
      },
      {
        name: "RetailCo User",
        email: "user@retailco.com",
        password: "User123!",
        role: "user",
      },
    ],
    products: [
      {
        name: "Classic Cotton Tee",
        description: "Soft everyday t-shirt made with breathable cotton.",
        price: 24.9,
        category: "Clothing",
        sampleImageFile: retailImageFiles.apparel,
      },
      {
        name: "Urban Fit Jeans",
        description: "Slim straight jeans with stretch fabric for all-day comfort.",
        price: 69.9,
        category: "Clothing",
        sampleImageFile: retailImageFiles.apparel,
      },
      {
        name: "Stride Runner Sneakers",
        description: "Lightweight sneakers with cushioned sole for daily wear.",
        price: 119.99,
        category: "Footwear",
        sampleImageFile: retailImageFiles.footwear,
      },
      {
        name: "Northline Bomber Jacket",
        description: "Water-resistant jacket with ribbed cuffs and zipper pockets.",
        price: 149.5,
        category: "Clothing",
        sampleImageFile: retailImageFiles.apparel,
      },
      {
        name: "City Peak Cap",
        description: "Adjustable cap with structured front panel and curved brim.",
        price: 21.5,
        category: "Accessories",
        sampleImageFile: retailImageFiles.accessory,
      },
      {
        name: "Transit Backpack",
        description: "Commuter backpack with padded laptop sleeve and bottle pocket.",
        price: 84.9,
        category: "Accessories",
        sampleImageFile: retailImageFiles.bag,
      },
      {
        name: "Metro Steel Watch",
        description: "Minimalist stainless steel watch for casual and office outfits.",
        price: 179,
        category: "Accessories",
        sampleImageFile: retailImageFiles.accessory,
      },
      {
        name: "Sunline Sunglasses",
        description: "Polarized sunglasses with lightweight acetate frame.",
        price: 59.4,
        category: "Accessories",
        sampleImageFile: retailImageFiles.accessory,
      },
      {
        name: "Heritage Leather Belt",
        description: "Genuine leather belt with matte buckle and classic finish.",
        price: 39.9,
        category: "Accessories",
        sampleImageFile: retailImageFiles.accessory,
      },
      {
        name: "PocketFold Wallet",
        description: "Compact wallet with RFID blocking and six card slots.",
        price: 44.75,
        category: "Accessories",
        sampleImageFile: retailImageFiles.accessory,
      },
    ],
  },
];

function validateSeedData(companies: SeedCompany[] = seedCompanies): SeedCompany[] {
  if (!Array.isArray(companies) || companies.length !== 2) {
    throw new Error("Seed dataset must define exactly 2 companies");
  }

  const normalizedNames = new Set<string>();

  for (const company of companies) {
    const normalizedName = company?.name?.trim().toLowerCase();

    if (!normalizedName) {
      throw new Error("Seed company name is required");
    }

    if (normalizedNames.has(normalizedName)) {
      throw new Error(`Seed company names must be distinct: ${company.name}`);
    }

    normalizedNames.add(normalizedName);

    if (!Array.isArray(company.users) || company.users.length < 2) {
      throw new Error(`Seed company must define at least 2 users: ${company.name}`);
    }

    const roles = new Set(company.users.map((user) => user.role));

    if (!roles.has("admin") || !roles.has("user")) {
      throw new Error(`Seed company must include admin and user roles: ${company.name}`);
    }

    if (!Array.isArray(company.products) || company.products.length < 10) {
      throw new Error(`Seed company must define at least 10 products: ${company.name}`);
    }

    const categories = new Set(company.products.map((product) => product.category));

    if (categories.size < 2) {
      throw new Error(`Seed company must include varied product categories: ${company.name}`);
    }

    for (const product of company.products) {
      if (!product.sampleImageFile.trim()) {
        throw new Error(`Seed product sample image is required: ${product.name}`);
      }
    }
  }

  return companies;
}

export { seedCompanies, validateSeedData };
