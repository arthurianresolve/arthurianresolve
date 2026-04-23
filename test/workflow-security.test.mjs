import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../.github/workflows/main.yml', import.meta.url), 'utf8');

test('[WORKFLOW-SEC-01] publishing executes only trusted main source with narrowly scoped write permission', () => {
  assert.doesNotMatch(workflow, /^\s*workflow_dispatch:/m);
  assert.match(workflow, /push:\s*\r?\n\s+branches: \[main\]/);
  assert.doesNotMatch(workflow, /^\s*paths(?:-ignore)?:/m, 'Initial-commit rewrites must still run generation.');
  assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
  assert.match(workflow, /jobs:\s*\r?\n\s+generate:[\s\S]*?permissions:\s*\r?\n\s+contents: write/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(workflow, /auth=\$\(printf 'x-access-token:%s' "\$GITHUB_TOKEN" \| base64 -w0\)/);
  assert.match(workflow, /http\.extraheader="AUTHORIZATION: basic \$\{auth\}"/);
});
