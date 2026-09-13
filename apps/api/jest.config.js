/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  // Backslashes are doubled because these are JS strings, not regex literals.
  // Written singly the escape is dropped, so `\.` became `.` — matching any
  // character, which pulled the source file `challenge-spec.ts` in as a test
  // suite and failed the run.
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    // Source uses explicit `.js` specifiers (NodeNext convention) which resolve to
    // `.ts` at compile time; Jest needs that mapping spelled out.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Workspace packages ship ESM + CJS; Jest resolves the CJS build.
    '^@forgeroutine/(.*)$': '<rootDir>/../../../packages/$1/dist/index.cjs',
  },
};
