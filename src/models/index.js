const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");
const ts = require("typescript");

function loadTypeScriptModule(relativePath) {
  const filename = path.join(__dirname, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  const wrappedModule = vm.runInThisContext(Module.wrap(outputText), {
    filename,
  });
  const localRequire = (request) => {
    if (request.startsWith(".")) {
      return require(path.join(path.dirname(relativePath), request));
    }

    return require(request);
  };

  wrappedModule(loadedModule.exports, localRequire, loadedModule, filename, path.dirname(filename));

  return loadedModule.exports;
}

const { Company, companySchema } = loadTypeScriptModule("Company.ts");
const {
  Conversation,
  conversationSchema,
  MessageRole,
  messageSchema,
} = loadTypeScriptModule("Conversation.ts");
const { Product, productSchema } = loadTypeScriptModule("Product.ts");
const { User, UserRole, userSchema } = loadTypeScriptModule("User.ts");

module.exports = {
  Company,
  companySchema,
  Conversation,
  conversationSchema,
  MessageRole,
  messageSchema,
  Product,
  productSchema,
  User,
  UserRole,
  userSchema,
};
