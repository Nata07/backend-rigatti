const { loadTypeScriptModule } = require("../src/utils/loadTypeScriptModule");

const seedModule = loadTypeScriptModule(__dirname, "./seed.ts");

if (require.main === module) {
  seedModule.main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Seed failed", error);
    process.exit(1);
  });
}

module.exports = seedModule;
