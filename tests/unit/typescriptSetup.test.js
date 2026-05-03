const fs = require("fs");
const path = require("path");
const ts = require("typescript");

describe("TypeScript setup", () => {
  const backendRoot = path.resolve(__dirname, "../..");
  const tsconfigPath = path.join(backendRoot, "tsconfig.json");
  const fixturePath = path.join(backendRoot, "tests/fixtures/type-contracts.ts");

  it("uses strict compiler options and emits build artifacts to dist", () => {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));

    expect(tsconfig.compilerOptions).toMatchObject({
      target: "ES2022",
      module: "commonjs",
      rootDir: "./src",
      outDir: "./dist",
      strict: true,
      alwaysStrict: true,
      strictBindCallApply: true,
      strictFunctionTypes: true,
      strictNullChecks: true,
      strictPropertyInitialization: true,
      noImplicitAny: true,
      noImplicitThis: true,
      useUnknownInCatchVariables: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      sourceMap: true,
      declaration: true,
      declarationMap: true
    });
  });

  it("validates the base interface contracts without diagnostics", () => {
    const { config } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, backendRoot);
    const compilerOptions = {
      ...parsed.options,
      noEmit: true,
      allowJs: false,
      rootDir: backendRoot
    };
    const program = ts.createProgram({
      rootNames: [fixturePath],
      options: compilerOptions
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);

    if (diagnostics.length > 0) {
      const host = {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => backendRoot,
        getNewLine: () => "\n"
      };
      const message = ts.formatDiagnosticsWithColorAndContext(diagnostics, host);
      throw new Error(message);
    }
  });
});
