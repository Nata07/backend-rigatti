const { loadTypeScriptModule } = require("../utils/loadTypeScriptModule");

module.exports = loadTypeScriptModule(__dirname, "./uploads.ts").default;
