const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");
const ts = require("typescript");

function loadTypeScriptModule(baseDirectory, relativePath) {
  const filename = path.resolve(baseDirectory, relativePath);
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
      return require(path.resolve(path.dirname(filename), request));
    }

    return require(request);
  };

  wrappedModule(loadedModule.exports, localRequire, loadedModule, filename, path.dirname(filename));

  return loadedModule.exports;
}

module.exports = {
  loadTypeScriptModule,
};
