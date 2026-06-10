/**
 * Configuración Jest con ts-jest para tests de utilidades puras (sin componentes React).
 * En .js (no .ts) para no requerir ts-node como dependencia adicional.
 * Para tests de componentes Next.js en el futuro, migrar a next/jest con SWC transformer.
 */
/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Resolver path aliases de tsconfig.json (@/ → src/)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Excluir imports de módulos que no son necesarios en tests de utilidades
  transformIgnorePatterns: [
    '/node_modules/(?!(xlsx)/)',
  ],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}',
    '<rootDir>/src/**/*.{spec,test}.{ts,tsx}',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/e2e/'],
  collectCoverageFrom: [
    'src/lib/**/*.{ts,tsx}',
    '!src/lib/**/*.d.ts',
    '!src/lib/__tests__/**',
  ],
}

module.exports = config
