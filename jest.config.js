const { resolve } = require('path');
const { pathsToModuleNameMapper } = require('ts-jest');
const CI = !!process.env.CI;

const ROOT_DIR = __dirname;
const TSCONFIG = resolve(ROOT_DIR, 'tsconfig.json');
const tsconfig = require(TSCONFIG);
const ESM_PACKAGES = [];

const uwsUtils = require('./uwsUtils');

const libcurl = require('node-libcurl');

module.exports = {
  testEnvironment: 'node',
  rootDir: ROOT_DIR,
  restoreMocks: true,
  reporters: ['default'],
  modulePathIgnorePatterns: ['dist', 'test-assets', 'test-files', 'fixtures', 'bun'],
  moduleNameMapper: pathsToModuleNameMapper(tsconfig.compilerOptions.paths, {
    prefix: `${ROOT_DIR}/`,
  }),
  transformIgnorePatterns: [`node_modules/(?!(${ESM_PACKAGES.join('|')})/)`],
  transform: {
    '^.+\\.mjs?$': 'babel-jest',
    '^.+\\.ts?$': 'babel-jest',
    '^.+\\.js$': 'babel-jest',
  },
  collectCoverage: false,
  globals: {
    uwsUtils,
    libcurl,
  },
  cacheDirectory: resolve(ROOT_DIR, `${CI ? '' : 'node_modules/'}.cache/jest`),
  resolver: 'bob-the-bundler/jest-resolver',
};
