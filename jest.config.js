/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@cline/core$': '<rootDir>/tests/shims/cline-sdk.ts',
    '^@cline/sdk$': '<rootDir>/tests/shims/cline-sdk.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: { module: 'esnext', target: 'es2022' } }],
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
};
