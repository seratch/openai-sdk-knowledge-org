module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true
    }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**/*',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@openai/agents$': '<rootDir>/src/__tests__/__mocks__/@openai/agents.js',
    '^@openai/agents-openai$': '<rootDir>/src/__tests__/__mocks__/@openai/agents-openai.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@openai/agents|@openai/agents-openai)/)'
  ],
  clearMocks: true,
  extensionsToTreatAsEsm: ['.ts'],
};
