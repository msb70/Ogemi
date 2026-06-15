import nextVitals from 'eslint-config-next/core-web-vitals'

const config = Array.isArray(nextVitals) ? nextVitals : [nextVitals]

export default [
  ...config,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },
  {
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]
