const { loadTypeScriptModule } = require("../utils/loadTypeScriptModule");

module.exports = loadTypeScriptModule(__dirname, "./chatStream.ts").default;
