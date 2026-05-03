const { loadTypeScriptModule } = require("../utils/loadTypeScriptModule");

module.exports = loadTypeScriptModule(__dirname, "./passwordReset.ts").default;
