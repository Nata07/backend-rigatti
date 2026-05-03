const fs = require("fs");
const path = require("path");
const { execFileSync, execSync } = require("child_process");

describe("TypeScript tooling integration", () => {
  const backendRoot = path.resolve(__dirname, "../..");
  const nodeCommand = process.execPath;
  const tscCli = path.join(backendRoot, "node_modules/typescript/lib/tsc.js");
  const tsNodeCli = path.join(backendRoot, "node_modules/ts-node/dist/bin.js");
  const eslintCli = path.join(backendRoot, "node_modules/eslint/bin/eslint.js");

  function runNodeScript(args) {
    return execFileSync(nodeCommand, args, {
      cwd: backendRoot,
      encoding: "utf8"
    });
  }

  function runNpmScript(scriptName) {
    return execSync(`npm run ${scriptName}`, {
      cwd: backendRoot,
      encoding: "utf8"
    });
  }

  it("builds the backend and generates source maps", () => {
    runNpmScript("build");

    expect(fs.existsSync(path.join(backendRoot, "dist/app.js"))).toBe(true);
    expect(fs.existsSync(path.join(backendRoot, "dist/app.js.map"))).toBe(true);
    expect(fs.existsSync(path.join(backendRoot, "dist/index.js"))).toBe(true);
    expect(fs.existsSync(path.join(backendRoot, "dist/index.js.map"))).toBe(true);
    expect(fs.existsSync(path.join(backendRoot, "dist/types/auth.d.ts"))).toBe(true);
    expect(fs.existsSync(path.join(backendRoot, "dist/types/auth.d.ts.map"))).toBe(true);
  });

  it("runs TypeScript files through ts-node", () => {
    const output = runNodeScript([tsNodeCli, "--project", "tsconfig.json", "tests/fixtures/ts-node-smoke.ts"]);

    expect(output).toContain("ts-node-ok:admin");
  });

  it("lints the TypeScript sources", () => {
    expect(() => runNodeScript([eslintCli, "--max-warnings=0", "src/types/**/*.ts"])).not.toThrow();
  });

  it("type-checks without emitting new artifacts", () => {
    runNpmScript("build");
    const distIndexPath = path.join(backendRoot, "dist/index.js");
    const before = fs.statSync(distIndexPath).mtimeMs;

    runNpmScript("type-check");

    expect(fs.statSync(distIndexPath).mtimeMs).toBe(before);
  });

  it("cleans the dist directory through the npm script", () => {
    runNpmScript("build");

    expect(fs.existsSync(path.join(backendRoot, "dist"))).toBe(true);

    runNpmScript("clean");

    expect(fs.existsSync(path.join(backendRoot, "dist"))).toBe(false);
  });
});
