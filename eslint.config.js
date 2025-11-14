import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**'
    ]
  },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked
    ],
    files: [
      '**/*.ts'
    ],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json'
      },
      globals: {
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        {
          'ts-expect-error': 'allow-with-description'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
  ,
  {
    files: ['**/*.config.ts', '**/*.workspace.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off'
    }
  }
);
