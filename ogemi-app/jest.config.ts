import type { Config } from 'jest'

/**
 * Configuración Jest con ts-jest para tests de utilidades puras (sin componentes React).
 * Para tests de componentes Next.js en el futuro, migrar a next/jest con SWC transformer.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Resolver path aliases de tsconfig.json (@/ → src/)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Excluir imports de módulos que no son necesarios en tests de utilidades
  // (react, next, etc.) — si se necesitan en el futuro, agregar mocks aquí
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

export default config
