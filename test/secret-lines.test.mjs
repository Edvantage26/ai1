// findSecretLines (src/core/secret-lines.mjs): literal secrets are found by line; placeholders,
// environment variable names and paths are not. Fake values are built at run time so no literal
// that looks like a secret sits in the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSecretLines } from '../src/core/secret-lines.mjs';

const fakeValue = ['Xy7', 'Qp2', 'Lm9', 'Rt4', 'Vb1'].join('');
const fakeLettersOnlyKey = 'acmk' + 'AbCdEfGhIjKlMnOpQrStUvWxYz'.repeat(2);
const fakeGithubToken = `ghp_${'a1B2c3D4e5'.repeat(4)}`;

test('secret lines: table cells, assignments, headers, URL passwords and known token prefixes', () => {
  const text = [
    '# Access',
    `| Password | \`${fakeValue}\` |`,
    `DOKPLOY_API_KEY="${fakeValue}"`,
    `curl -H "x-api-key: ${fakeValue}" https://example.com`,
    `postgresql://admin:${fakeValue}@db.internal:5432/app`,
    `token in a sentence ${fakeGithubToken}`,
    `| API Key | \`${fakeLettersOnlyKey}\` |`,
  ].join('\n');
  assert.deepEqual(findSecretLines(text), [2, 3, 4, 5, 6, 7]);
});

test('secret lines: placeholders, env var names, 1Password references and paths are not secrets', () => {
  const text = [
    'Header `x-api-key: <API Key>`, value in `$DOKPLOY_API_KEY`.',
    'Credentials in `.env.local`: `TRELLO_API_KEY`, `TRELLO_TOKEN`.',
    'Password: 1Password item "Acme - PostgreSQL" (op://Shared Vault/item/password).',
    'Token file: `config/tokens/service-account.json`',
    'stripe listen --api-key "$SK" --forward-to localhost:9008/api/webhooks/stripe',
    'postgresql://admin:${PG_PASSWORD}@db.internal/app',
    'Rotate the token every 90 days.',
    '| `verify` | on | after the last passing run of the `verify` commands (run in full) 2026-11-15T10:00:00Z |',
    'The PasswordResetController handles it.',
  ].join('\n');
  assert.deepEqual(findSecretLines(text), []);
});
