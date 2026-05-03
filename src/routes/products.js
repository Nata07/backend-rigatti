const { loadTypeScriptModule } = require("../utils/loadTypeScriptModule");

module.exports = loadTypeScriptModule(__dirname, "./products.ts").default;
