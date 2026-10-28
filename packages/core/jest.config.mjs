export default {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.mjs'],
  testTimeout: 30_000,
  collectCoverageFrom: ['hooks/**/*.mjs', 'lib/**/*.mjs', '!**/*.test.*'],
  coverageReporters: ['text-summary', 'json-summary'],
  coverageThreshold: {
    './hooks/': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './lib/': { statements: 90 },
    './lib/host.mjs': { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
