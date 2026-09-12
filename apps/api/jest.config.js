/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\.spec\.ts$',
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    // Source uses explicit `.js` specifiers (NodeNext convention) which resolve to
    // `.ts` at compile time; Jest needs that mapping spelled out.
    '^(\.{1,2}/.*)\.js$': '$1',
    // Workspace packages ship ESM + CJS; Jest resolves the CJS build.
    '^@forgeroutine/(.*)$': '<rootDir>/../../../packages/$1/dist/index.cjs',
  },
};
