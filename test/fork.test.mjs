import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectForkHost } from '../src/session/fork-host.mjs';
import { forkFullConversation, startBriefConversation, resolveHandoffPath } from '../src/session/fork-session.mjs';
import { runForkCommand } from '../src/cli/fork-command.mjs';

const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const PASEO_AGENT = 'agent-current';

// A fake runner for claude, paseo and code: records every call and answers like the real CLIs.
function createFakeRunner({ provider = 'claude', failing = '' } = {}) {
  const calls = [];
  const runCommand = (programName, programArguments, commandOptions = {}) => {
    calls.push({ programName, programArguments, cwd: commandOptions.cwd, extraEnvironment: commandOptions.extraEnvironment });
    if (failing && `${programName} ${programArguments[0]}` === failing) return { status: 2, stdout: '', stderr: 'boom' };
    if (programName === 'paseo' && programArguments[0] === 'inspect') return { status: 0, stdout: JSON.stringify({ Id: PASEO_AGENT, Name: 'Rename work', Provider: provider, Model: 'claude-opus-5-5', Mode: 'bypassPermissions' }) };
    if (programName === 'paseo' && programArguments[0] === 'import') return { status: 0, stdout: JSON.stringify({ id: 'agent-full-fork' }) };
    if (programName === 'paseo' && programArguments[0] === 'run') return { status: 0, stdout: JSON.stringify({ id: 'agent-brief' }) };
    return { status: 0, stdout: programName === 'paseo' ? '{}' : 'ready\n', stderr: '' };
  };
  return { calls, runCommand, callsOf: (programName, firstArgument) => calls.filter((call) => call.programName === programName && (!firstArgument || call.programArguments[0] === firstArgument)) };
}

// A Paseo home without config: the seed run falls back to plain `claude`.
const EMPTY_PASEO_HOME = mkdtempSync(join(tmpdir(), 'ai1-paseo-home-'));

function writeBrief(briefText = '# Fix the login timeout\n\nOnly touch src/auth.\n') {
  const briefPath = join(mkdtempSync(join(tmpdir(), 'ai1-brief-')), 'brief.md');
  writeFileSync(briefPath, briefText);
  return briefPath;
}

test('host detection: Paseo, web, VS Code, then terminal; Desktop only on macOS and Windows', () => {
  assert.equal(detectForkHost({ PASEO_AGENT_ID: 'x', TERM_PROGRAM: 'vscode' }, 'linux').id, 'paseo');
  assert.equal(detectForkHost({ CLAUDE_CODE_REMOTE: 'true' }, 'darwin').id, 'web');
  assert.equal(detectForkHost({ CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' }, 'linux').id, 'vscode');
  assert.equal(detectForkHost({ TERM_PROGRAM: 'vscode' }, 'linux').reason, 'TERM_PROGRAM=vscode');
  assert.equal(detectForkHost({ CLAUDE_CODE_ENTRYPOINT: 'cli' }, 'linux').id, 'terminal');
  assert.equal(detectForkHost({}, 'darwin').canOpenInDesktop, true);
  assert.equal(detectForkHost({}, 'linux').canOpenInDesktop, false);
});

test('full fork in Paseo: forks the session with a new id and imports it as a labelled agent', () => {
  const fakeRunner = createFakeRunner();
  const environment = { CLAUDE_CODE_SESSION_ID: SESSION_ID, PASEO_AGENT_ID: PASEO_AGENT, PASEO_HOME: EMPTY_PASEO_HOME };
  const forkResult = forkFullConversation({ environment, cwd: '/repo', host: detectForkHost(environment, 'linux'), task: 'Try the other approach', runCommand: fakeRunner.runCommand });
  const [claudeCall] = fakeRunner.callsOf('claude');
  assert.deepEqual(claudeCall.programArguments.slice(0, 8), ['-p', '--resume', SESSION_ID, '--fork-session', '--session-id', forkResult.sessionId, '--tools', '']);
  assert.deepEqual(claudeCall.programArguments.slice(8, 10), ['--model', 'claude-opus-5-5']);
  assert.equal(claudeCall.cwd, '/repo');
  assert.notEqual(forkResult.sessionId, SESSION_ID);
  const [importCall] = fakeRunner.callsOf('paseo', 'import');
  assert.deepEqual(importCall.programArguments.slice(0, 6), ['import', forkResult.sessionId, '--provider', 'claude', '--cwd', '/repo']);
  assert.ok(importCall.programArguments.includes('forked_from=agent-current'));
  assert.ok(importCall.programArguments.includes('fork_mode=full'));
  assert.deepEqual(fakeRunner.callsOf('paseo', 'agent')[0].programArguments.slice(0, 5), ['agent', 'update', 'agent-full-fork', '--name', 'Fork: Rename work']);
  const [sendCall] = fakeRunner.callsOf('paseo', 'send');
  assert.equal(readFileSync(sendCall.programArguments[sendCall.programArguments.indexOf('--prompt-file') + 1], 'utf8'), 'Try the other approach');
  assert.equal(forkResult.agentId, 'agent-full-fork');
  assert.equal(forkResult.openWith[0].command, 'paseo agent open agent-full-fork');
  assert.equal(forkResult.opened, 'paseo');
});

test('full fork in VS Code opens the extension URI; in a terminal it only returns the commands', () => {
  const vscodeRunner = createFakeRunner();
  const vscodeEnvironment = { CLAUDE_CODE_SESSION_ID: SESSION_ID, TERM_PROGRAM: 'vscode' };
  const vscodeResult = forkFullConversation({ environment: vscodeEnvironment, cwd: '/repo', host: detectForkHost(vscodeEnvironment, 'darwin'), runCommand: vscodeRunner.runCommand });
  assert.deepEqual(vscodeRunner.callsOf('code')[0].programArguments, ['--open-url', `vscode://anthropic.claude-code/open?session=${vscodeResult.sessionId}`]);
  assert.equal(vscodeResult.opened, 'vscode');
  assert.ok(vscodeResult.openWith.some((openOption) => openOption.command === `claude --desktop --resume ${vscodeResult.sessionId}`));
  assert.equal(vscodeRunner.callsOf('claude')[0].programArguments.includes('--model'), false, 'no model is forced outside Paseo');

  const terminalRunner = createFakeRunner();
  const terminalEnvironment = { CLAUDE_CODE_SESSION_ID: SESSION_ID };
  const terminalResult = forkFullConversation({ environment: terminalEnvironment, cwd: '/repo', host: detectForkHost(terminalEnvironment, 'linux'), task: 'next', runCommand: terminalRunner.runCommand });
  assert.equal(terminalRunner.callsOf('code').length + terminalRunner.callsOf('paseo').length, 0);
  assert.equal(terminalResult.openWith[0].command, `claude --resume ${terminalResult.sessionId}`);
  assert.equal(terminalResult.opened, null);
  assert.equal(terminalResult.task, 'next');
});

test('full fork refuses on the web, without a session id, on a non-Claude Paseo agent, and when claude fails', () => {
  const fakeRunner = createFakeRunner();
  assert.throws(() => forkFullConversation({ environment: { CLAUDE_CODE_SESSION_ID: SESSION_ID, CLAUDE_CODE_REMOTE: 'true' }, cwd: '/repo', host: detectForkHost({ CLAUDE_CODE_REMOTE: 'true' }), runCommand: fakeRunner.runCommand }), /not possible on the web.*brief/);
  assert.throws(() => forkFullConversation({ environment: {}, cwd: '/repo', host: detectForkHost({}), runCommand: fakeRunner.runCommand }), /CLAUDE_CODE_SESSION_ID/);
  const codexRunner = createFakeRunner({ provider: 'codex' });
  const paseoEnvironment = { CLAUDE_CODE_SESSION_ID: SESSION_ID, PASEO_AGENT_ID: PASEO_AGENT, PASEO_HOME: EMPTY_PASEO_HOME };
  assert.throws(() => forkFullConversation({ environment: paseoEnvironment, cwd: '/repo', host: detectForkHost(paseoEnvironment), runCommand: codexRunner.runCommand }), /"codex".*brief mode/);
  assert.equal(codexRunner.callsOf('claude').length, 0);
  const failingRunner = createFakeRunner({ failing: 'claude -p' });
  assert.throws(() => forkFullConversation({ environment: { CLAUDE_CODE_SESSION_ID: SESSION_ID }, cwd: '/repo', host: detectForkHost({}), runCommand: failingRunner.runCommand }), /`claude -p` failed \(exit 2\): boom/);
});

test('full fork in Paseo runs the seed through the launcher Paseo uses for the provider', () => {
  const paseoHome = mkdtempSync(join(tmpdir(), 'ai1-paseo-home-'));
  writeFileSync(join(paseoHome, 'config.json'), JSON.stringify({ agents: { providers: {
    claude: { command: ['/opt/bin/claude-account-exec', '--quiet'] },
    'claude-team': { extends: 'claude', env: { CLAUDE_ACCOUNT_NAME: 'team' } },
  } } }));
  const fakeRunner = createFakeRunner({ provider: 'claude-team/claude-opus-5-5' });
  const environment = { CLAUDE_CODE_SESSION_ID: SESSION_ID, PASEO_AGENT_ID: PASEO_AGENT, PASEO_HOME: paseoHome };
  forkFullConversation({ environment, cwd: '/repo', host: detectForkHost(environment), runCommand: fakeRunner.runCommand });
  const [seedCall] = fakeRunner.callsOf('/opt/bin/claude-account-exec');
  assert.deepEqual(seedCall.programArguments.slice(0, 4), ['--quiet', '-p', '--resume', SESSION_ID]);
  assert.deepEqual(seedCall.extraEnvironment, { CLAUDE_ACCOUNT_NAME: 'team' });
  assert.equal(fakeRunner.callsOf('paseo', 'import')[0].programArguments[3], 'claude-team');
});

test('brief in Paseo: runs a detached agent with the same provider, model and mode and the brief as prompt', () => {
  const fakeRunner = createFakeRunner();
  const environment = { PASEO_AGENT_ID: PASEO_AGENT };
  const briefPath = writeBrief();
  const briefResult = startBriefConversation({ environment, cwd: '/repo', host: detectForkHost(environment), briefPath, runCommand: fakeRunner.runCommand });
  const runArguments = fakeRunner.callsOf('paseo', 'run')[0].programArguments;
  assert.deepEqual(runArguments.slice(0, 13), ['run', '-d', '--json', '--title', 'Fix the login timeout', '--provider', 'claude', '--model', 'claude-opus-5-5', '--mode', 'bypassPermissions', '--cwd', '/repo']);
  assert.ok(runArguments.includes('fork_mode=brief'));
  assert.equal(runArguments.at(-1), '# Fix the login timeout\n\nOnly touch src/auth.');
  assert.deepEqual(fakeRunner.callsOf('paseo', 'agent')[0].programArguments.slice(0, 3), ['agent', 'detach', 'agent-brief']);
  assert.equal(fakeRunner.callsOf('claude').length, 0, 'a brief never copies the conversation');
  assert.equal(briefResult.agentId, 'agent-brief');
});

test('brief elsewhere: terminal command, VS Code prompt URI, Desktop link; web asks to paste', () => {
  const briefPath = writeBrief("# It's scoped\nbody");
  const vscodeRunner = createFakeRunner();
  const vscodeResult = startBriefConversation({ environment: {}, cwd: '/repo', host: detectForkHost({ TERM_PROGRAM: 'vscode' }, 'win32'), briefPath, runCommand: vscodeRunner.runCommand });
  assert.equal(vscodeRunner.callsOf('code')[0].programArguments[1], `vscode://anthropic.claude-code/open?prompt=${encodeURIComponent("# It's scoped\nbody")}`);
  assert.ok(vscodeResult.openWith.some((openOption) => openOption.command.startsWith('claude://code/new?q=%23%20It')));
  assert.equal(vscodeResult.openWith[0].command, `claude "$(cat '${briefPath}')"`);
  const webResult = startBriefConversation({ environment: {}, cwd: '/repo', host: detectForkHost({ CLAUDE_CODE_REMOTE: 'true' }), briefPath, title: 'Scoped', runCommand: createFakeRunner().runCommand });
  assert.deepEqual(webResult.openWith.map((openOption) => openOption.label), ['new web session']);
  assert.equal(webResult.title, 'Scoped');
  assert.throws(() => startBriefConversation({ environment: {}, cwd: '/repo', host: detectForkHost({}), briefPath: join(tmpdir(), 'no-such-brief.md'), runCommand: createFakeRunner().runCommand }), /no brief file/);
});

test('handoff path: .ai1/work/handoffs/ in an ai1 repo, the temp dir otherwise; slugs are checked', () => {
  const ai1Repo = mkdtempSync(join(tmpdir(), 'ai1-fork-repo-'));
  mkdirSync(join(ai1Repo, '.ai1'));
  assert.equal(resolveHandoffPath(ai1Repo, 'login-timeout'), join(ai1Repo, '.ai1', 'work', 'handoffs', 'login-timeout.md'));
  assert.ok(existsSync(join(ai1Repo, '.ai1', 'work', 'handoffs')));
  assert.equal(readFileSync(join(ai1Repo, '.ai1', 'work', '.gitignore'), 'utf8'), '*\n', 'handoffs stay out of git without the lanes feature');
  const plainRepo = mkdtempSync(join(tmpdir(), 'ai1-fork-plain-'));
  assert.equal(resolveHandoffPath(plainRepo, 'x').startsWith(join(tmpdir(), 'ai1-handoffs')), true);
  assert.throws(() => resolveHandoffPath(ai1Repo, '../escape'), /invalid handoff slug/);
});

test('ai1 fork CLI: host, brief-path and full with --json; unknown subcommand prints usage', () => {
  const outputLines = [];
  const commandArguments = ['full', '--title', 'Other way', '--json'];
  const readOption = (optionName) => { const optionIndex = commandArguments.indexOf(optionName); return optionIndex >= 0 ? commandArguments[optionIndex + 1] : undefined; };
  const exitCode = runForkCommand('/repo', commandArguments, { readOption, environment: { CLAUDE_CODE_SESSION_ID: SESSION_ID }, runCommand: createFakeRunner().runCommand, platformName: 'linux', writeOutput: (outputText) => outputLines.push(outputText) });
  assert.equal(exitCode, 0);
  const forkJson = JSON.parse(outputLines[0]);
  assert.equal(forkJson.title, 'Other way');
  assert.equal(forkJson.host.id, 'terminal');
  const briefArguments = ['brief', '--file', writeBrief(), '--cwd', '/elsewhere', '--json'];
  const readBriefOption = (optionName) => { const optionIndex = briefArguments.indexOf(optionName); return optionIndex >= 0 ? briefArguments[optionIndex + 1] : undefined; };
  const briefRunner = createFakeRunner();
  runForkCommand('/repo', briefArguments, { readOption: readBriefOption, environment: { PASEO_AGENT_ID: PASEO_AGENT }, runCommand: briefRunner.runCommand, platformName: 'linux', writeOutput: () => {} });
  const runArguments = briefRunner.callsOf('paseo', 'run')[0].programArguments;
  assert.equal(runArguments[runArguments.indexOf('--cwd') + 1], '/elsewhere', 'brief --cwd starts the conversation elsewhere');
  const usageLines = [];
  assert.equal(runForkCommand('/repo', ['nope'], { readOption: () => undefined, environment: {}, writeOutput: (outputText) => usageLines.push(outputText) }), 1);
  assert.match(usageLines[0], /usage: ai1 fork full/);
});
