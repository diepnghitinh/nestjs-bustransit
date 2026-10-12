/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test/integration/'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }] },
  setupFiles: ['reflect-metadata'],
  testTimeout: 10000,
};
