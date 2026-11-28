import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTranscriptPath, listPersonTurns, readPersonTurns } from '../src/session/conversation-turns.mjs';
import { writeTranscript } from './helpers.mjs';

const SESSION_ID = '11111111-2222-3333-4444-555555555555';

test('the person\'s turns: only what they typed, numbered, each with the last assistant message before it', () => {
  const configDirectory = mkdtempSync(join(tmpdir(), 'ai1-claude-config-'));
  writeTranscript(configDirectory, SESSION_ID);
  assert.equal(findTranscriptPath(SESSION_ID, { CLAUDE_CONFIG_DIR: configDirectory }), join(configDirectory, 'projects', '-repo', `${SESSION_ID}.jsonl`));
  assert.equal(findTranscriptPath('other-session', { CLAUDE_CONFIG_DIR: configDirectory }), null);
  const personTurns = readPersonTurns(SESSION_ID, { CLAUDE_CONFIG_DIR: configDirectory });
  assert.deepEqual(personTurns.map((personTurn) => [personTurn.number, personTurn.preview, personTurn.cutBeforeMessageId]), [
    [1, 'Build the export', null],
    [2, 'By the way, the login is slow', 'a2'],
  ]);
  assert.throws(() => readPersonTurns('other-session', { CLAUDE_CONFIG_DIR: configDirectory }), /no transcript found/);
  assert.equal(listPersonTurns(`{"type":"user","uuid":"u","message":{"content":"${'x'.repeat(150)}"}}`)[0].preview.length, 101);
});
