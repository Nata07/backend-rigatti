const { loadTypeScriptModule } = require("./utils/loadTypeScriptModule");

module.exports = loadTypeScriptModule(__dirname, "./app.ts");
