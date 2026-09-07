// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

/**
 * Several of CONTRIBUTING.md's "hard rules" are mechanically checkable. A rule that
 * lives only in a markdown file eventually gets violated, so they are enforced here.
 * See docs/living-spec.md D-010.
 */
const bannedSyntax = [
  {
    selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
    message: 'innerHTML/outerHTML are banned (CONTRIBUTING hard rule 6). Use textContent.',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'insertAdjacentHTML is banned (CONTRIBUTING hard rule 6).',
  },
  {
    selector: 'CallExpression[callee.property.name=/^bypassSecurityTrust/]',
    message: 'bypassSecurityTrust* is banned (CONTRIBUTING hard rule 6).',
  },
  {
    selector: "MemberExpression[object.name='document'][property.name='write']",
    message: 'document.write is banned (CONTRIBUTING hard rule 6).',
  },
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message: 'Math.random is not a CSPRNG. Use crypto.getRandomValues() (SECURITY.md).',
  },
];

module.exports = defineConfig([
  {
    ignores: ['dist/**', 'coverage/**', '.angular/**', 'playwright-report/**', 'test-results/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],

      // Hard rules 1 & 6 — no dynamic code execution.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-syntax': ['error', ...bannedSyntax],

      // CONTRIBUTING code style: no `any` without a justifying comment.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  /*
   * Layer boundaries from docs/architecture.md, enforced with a built-in rule so
   * this costs no dependency (hard rule 4).
   *
   *   UI -> vault service -> format -> crypto
   *                       -> storage -> providers
   */
  {
    files: ['src/app/core/crypto/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@angular/*', 'rxjs', 'rxjs/*'],
              message:
                'The crypto layer is pure functions over Uint8Array — no Angular, no DOM, no I/O (architecture.md).',
            },
            {
              group: ['**/format/**', '**/storage/**', '**/vault/**', '**/ui/**'],
              message: 'The crypto layer must not know what a vault is (architecture.md).',
            },
          ],
        },
      ],
      // Hard rule 3 — never log secret material, not even in dev builds.
      'no-console': 'error',
    },
  },
  {
    files: ['src/app/core/format/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/storage/**', '**/ui/**', '@angular/*'],
              message: 'The format layer depends only on the crypto layer (architecture.md).',
            },
          ],
        },
      ],
      'no-console': 'error',
    },
  },
  {
    files: ['src/app/core/storage/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/crypto/**', '**/format/**', '**/ui/**'],
              message:
                'Storage providers handle ciphertext only. A provider must not be able to reach plaintext or keys (architecture.md, hard rule 3).',
            },
          ],
        },
      ],
      'no-console': 'error',
    },
  },
  {
    files: ['src/app/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core/crypto/**', '**/core/format/**', '**/core/storage/**'],
              message:
                'The UI reads the vault domain model only — it never touches crypto or storage directly (architecture.md).',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
