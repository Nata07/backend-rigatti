const path = require("path");

describe("tooling configuration", () => {
  const backendRoot = path.resolve(__dirname, "../..");
  const packageJson = require(path.join(backendRoot, "package.json"));
  const jestConfig = require(path.join(backendRoot, "jest.config.js"));
  const transformer = require(path.join(backendRoot, "jest.typescript-transformer.js"));

  it("uses TypeScript-aware npm scripts", () => {
    expect(packageJson.main).toBe("dist/index.js");
    expect(packageJson.scripts.build).toBe("tsc -p tsconfig.json");
    expect(packageJson.scripts.start).toBe("node dist/index.js");
    expect(packageJson.scripts.dev).toContain("ts-node/register");
    expect(packageJson.scripts.dev).toContain("--watch");
    expect(packageJson.scripts["type-check"]).toBe("tsc -p tsconfig.json --noEmit");
    expect(packageJson.scripts.clean).toContain("rmSync('dist'");
  });

  it("loads TypeScript test files through the dedicated Jest transformer", () => {
    expect(jestConfig.roots).toEqual(["<rootDir>/src", "<rootDir>/tests"]);
    expect(jestConfig.testMatch).toContain("**/*.test.[jt]s");
    expect(jestConfig.transform["^.+\\.ts$"]).toBe("<rootDir>/jest.typescript-transformer.js");

    const transformed = transformer.process("export const value: string = 'ok';", "fixture.ts");

    expect(transformed.code).toContain("exports.value = 'ok'");
  });
});
