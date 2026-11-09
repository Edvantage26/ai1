import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStateJson } from '../src/core/session-state.mjs';

test('readStateJson returns the parsed state, or the fallback when missing or broken', () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'ai1-state-'));
  const statePath = join(stateDirectory, 'x.state');
  assert.deepEqual(readStateJson(statePath), {});
  assert.deepEqual(readStateJson(statePath, { count: 0 }), { count: 0 });
  writeFileSync(statePath, '{"count": 2}');
  assert.deepEqual(readStateJson(statePath), { count: 2 });
  writeFileSync(statePath, '{broken');
  assert.deepEqual(readStateJson(statePath, { count: 0 }), { count: 0 });
  writeFileSync(statePath, 'null');
  assert.deepEqual(readStateJson(statePath), {});
});
