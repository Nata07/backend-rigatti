const { loadTypeScriptModule } = require("../src/utils/loadTypeScriptModule");

module.exports = loadTypeScriptModule(__dirname, "./seedData.ts");
