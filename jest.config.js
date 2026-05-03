module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/*.test.[jt]s"],
  moduleFileExtensions: ["js", "ts", "json"],
  coverageReporters: ["text", "html", "lcov"],
  transform: {
    "^.+\\.ts$": "<rootDir>/jest.typescript-transformer.js",
  },
  collectCoverageFrom: [
    "src/**/*.js",
    "scripts/**/*.js",
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
