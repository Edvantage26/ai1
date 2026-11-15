import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyForkOpener, detectForkHost } from '../src/session/fork-host.mjs';
import { forkFullConversation, startBriefConversation, resolveHandoffPath } from '../src/session/fork-session.mjs';
import { runForkCommand } from '../src/cli/fork-command.mjs';

const SESSION_ID = '11111111-2222-3333-4444-555555555555';
// A fake runner for claude, code and the opener command (`sh -c`): records every call.
function createFakeRunner({ failing = '', commandOutput = 'opened agent-42' } = {}) {
  const calls = [];
  const runCommand = (programName, programArguments, commandOptions = {}) => {
    calls.push({ programName, programArguments, cwd: commandOptions.cwd, extraEnvironment: commandOptions.extraEnvironment });
    if (failing && `${programName} ${programArguments[0]}` === failing) return { status: 2, stdout: '', stderr: 'boom' };
    if (programName === 'sh') return { status: 0, stdout: `${commandOutput}\n`, stderr: '' };
    return { status: 0, stdout: 'ready\n', stderr: '' };
  };
  return { calls, runCommand, callsOf: (programName, firstArgument) => calls.filter((call) => call.programName === programName && (!firstArgument || call.programArguments[0] === firstArgument)) };
}

function writeBrief(briefText = '# Fix the login timeout\n\nOnly touch src/auth.\n') {
  const briefPath = join(mkdtempSync(join(tmpdir(), 'ai1-brief-')), 'brief.md');
  writeFileSync(briefPath, briefText);
  return briefPath;
}

test('host detection: web, VS Code, then terminal; no agent manager is detected; Desktop only on macOS and Windows [fork-without-paseo:S1]', () => {
  assert.equal(detectForkHost({ PASEO_AGENT_ID: 'x', TERM_PROGRAM: 'vscode' }, 'linux').id, 'vscode');
  assert.equal(detectForkHost({ PASEO_AGENT_ID: 'x' }, 'linux').id, 'terminal');
  assert.equal(detectForkHost({ CLAUDE_CODE_REMOTE: 'true' }, 'darwin').id, 'web');
  assert.equal(detectForkHost({ CLAUDE_CODE_ENTRYPOINT: 'claude-vscode' }, 'linux').id, 'vscode');
  assert.equal(detectForkHost({ TERM_PROGRAM: 'vscode' }, 'linux').reason, 'TERM_PROGRAM=vscode');
  assert.equal(detectForkHost({ CLAUDE_CODE_ENTRYPOINT: 'cli' }, 'linux').id, 'terminal');
  assert.equal(detectForkHost({}, 'darwin').canOpenInDesktop, true);
  assert.equal(detectForkHost({}, 'linux').canOpenInDesktop, false);
});

test('full fork in VS Code opens the extension URI; in a terminal it only returns the commands', () => {
  const vscodeRunner = createFakeRunner();
  const vscodeEnvironment = { CLAUDE_CODE_SESSION_ID: SESSION_ID, TERM_PROGRAM: 'vscode' };
  const vscodeResult = forkFullConversation({ environment: vscodeEnvironment, cwd: '/repo', host: detectForkHost(vscodeEnvironment, 'darwin'), runCommand: vscodeRunner.runCommand });
  assert.deepEqual(vscodeRunner.callsOf('code')[0].programArguments, ['--open-url', `vscode://anthropic.claude-code/open?session=${vscodeResult.sessionId}`]);
  assert.equal(vscodeResult.opened, 'vscode');
  assert.ok(vscodeResult.openWith.some((openOption) => openOption.command === `claude --desktop --resume ${vscodeResult.sessionId}`));
  assert.equal(vscodeRunner.callsOf('claude')[0].programArguments.includes('--model'), false, 'no model is forced');

  const terminalRunner = createFakeRunner();
  const terminalEnvironment = { CLAUDE_CODE_SESSION_ID: SESSION_ID };
  const terminalResult = forkFullConversation({ environment: terminalEnvironment, cwd: '/repo', host: detectForkHost(terminalEnvironment, 'linux'), task: 'next', runCommand: terminalRunner.runCommand });
  assert.equal(terminalRunner.callsOf('code').length + terminalRunner.callsOf('paseo').length + terminalRunner.callsOf('sh').length, 0);
  assert.equal(terminalResult.openWith[0].command, `claude --resume ${terminalResult.sessionId}`);
  assert.equal(terminalResult.opened, null);
  assert.equal(terminalResult.task, 'next');
});

test('full fork refuses on the web, without a session id, and when claude fails [fork-without-paseo:S1]', () => {
  const fakeRunner = createFakeRunner();
  assert.throws(() => forkFullConversation({ environment: { CLAUDE_CODE_SESSION_ID: SESSION_ID, CLAUDE_CODE_REMOTE: 'true' }, cwd: '/repo', host: detectForkHost({ CLAUDE_CODE_REMOTE: 'true' }), runCommand: fakeRunner.runCommand }), /not possible on the web.*brief/);
  assert.throws(() => forkFullConversation({ environment: {}, cwd: '/repo', host: detectForkHost({}), runCommand: fakeRunner.runCommand }), /CLAUDE_CODE_SESSION_ID/);
  const failingRunner = createFakeRunner({ failing: 'claude -p' });
  assert.throws(() => forkFullConversation({ environment: { CLAUDE_CODE_SESSION_ID: SESSION_ID }, cwd: '/repo', host: detectForkHost({}), runCommand: failingRunner.runCommand }), /`claude -p` failed \(exit 2\): boom/);
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
  assert.equal(readFileSync(join(ai1Repo, '.ai1', 'work', '.gitignore'), 'utf8'), '*\n', 'handoffs stay out of git without the sizing feature');
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
  const briefLines = [];
  runForkCommand('/repo', briefArguments, { readOption: readBriefOption, environment: { PASEO_AGENT_ID: 'x' }, runCommand: briefRunner.runCommand, platformName: 'linux', writeOutput: (outputText) => briefLines.push(outputText) });
  assert.equal(briefRunner.calls.length, 0, 'nothing is run for a brief in a terminal, whatever agent manager is around');
  assert.equal(JSON.parse(briefLines[0]).opened, null);
  const usageLines = [];
  assert.equal(runForkCommand('/repo', ['nope'], { readOption: () => undefined, environment: {}, writeOutput: (outputText) => usageLines.push(outputText) }), 1);
  assert.match(usageLines[0], /usage: ai1 fork full/);
});

test('fork opener: unset, auto or invalid keep the detected host; web and Desktop on Linux ignore it; otherwise it wins', () => {
  const terminalHost = detectForkHost({}, 'linux');
  for (const unsetValue of [undefined, '', '${user_config.fork_opener}', 'auto']) {
    assert.deepEqual(applyForkOpener(terminalHost, unsetValue), { host: terminalHost, notice: null });
  }
  assert.equal(applyForkOpener(terminalHost, 'slack').host, terminalHost);
  assert.match(applyForkOpener(terminalHost, 'slack').notice, /unknown fork opener "slack"/);
  assert.match(applyForkOpener(detectForkHost({ CLAUDE_CODE_REMOTE: 'true' }), 'vscode').notice, /runs on the web/);
  assert.match(applyForkOpener(terminalHost, 'desktop').notice, /does not open sessions/);
  const chosenVscode = applyForkOpener(terminalHost, 'VSCode'.toLowerCase()).host;
  assert.equal(chosenVscode.id, 'vscode');
  assert.equal(chosenVscode.detectedId, 'terminal');
  assert.equal(applyForkOpener(detectForkHost({}, 'darwin'), 'desktop').host.id, 'desktop');
});

test('fork opener paseo is no longer built in: the detected host, and a note pointing to the guided setup [fork-without-paseo:S3]', () => {
  const terminalHost = detectForkHost({}, 'linux');
  const { host, notice } = applyForkOpener(terminalHost, 'paseo');
  assert.equal(host, terminalHost);
  assert.match(notice, /no longer built into ai1.*Open forks in another tool/);
  const desktopHost = applyForkOpener(detectForkHost({}, 'darwin'), 'desktop').host;
  const desktopResult = startBriefConversation({ environment: {}, cwd: '/repo', host: desktopHost, briefPath: writeBrief(), runCommand: createFakeRunner().runCommand });
  assert.equal(desktopResult.openWith[0].label, 'Claude Desktop');
  assert.equal(desktopResult.opened, null);
});

test('brief with the person\'s opener command: placeholders filled shell-quoted, run with sh -c, output reported [fork-without-paseo:S2]', () => {
  const fakeRunner = createFakeRunner();
  const briefPath = writeBrief("# It's the login\nbody");
  const briefResult = startBriefConversation({ environment: {}, cwd: '/repo', host: detectForkHost({ TERM_PROGRAM: 'vscode' }, 'linux'), briefPath, openCommand: 'my-opener --mode {mode} --cwd {cwd} --title {title} --brief {brief_file} --session {session_id}', runCommand: fakeRunner.runCommand });
  const [shellCall] = fakeRunner.callsOf('sh');
  assert.deepEqual(shellCall.programArguments.slice(0, 1), ['-c']);
  assert.equal(shellCall.programArguments[1], `my-opener --mode 'brief' --cwd '/repo' --title 'It'\\''s the login' --brief '${briefPath}' --session ''`);
  assert.equal(shellCall.cwd, '/repo');
  assert.equal(fakeRunner.callsOf('code').length, 0, 'the opener command replaces the VS Code URI');
  assert.equal(briefResult.opened, 'command');
  assert.equal(briefResult.output, 'opened agent-42');
  // from AI1_FORK_COMMAND too, and ignored on the web
  const envRunner = createFakeRunner();
  startBriefConversation({ environment: { AI1_FORK_COMMAND: 'env-opener {brief_file}' }, cwd: '/repo', host: detectForkHost({}, 'linux'), briefPath, runCommand: envRunner.runCommand });
  assert.match(envRunner.callsOf('sh')[0].programArguments[1], /^env-opener '/);
  const webRunner = createFakeRunner();
  const webResult = startBriefConversation({ environment: {}, cwd: '/repo', host: detectForkHost({ CLAUDE_CODE_REMOTE: 'true' }), briefPath, openCommand: 'my-opener', runCommand: webRunner.runCommand });
  assert.equal(webRunner.calls.length, 0);
  assert.match(webResult.notice, /ignored on the web/);
});

test('full fork with the opener command: the command creates the session (ids, task file), ai1 does not seed it [fork-without-paseo:S2]', () => {
  const fakeRunner = createFakeRunner();
  const environment = { CLAUDE_CODE_SESSION_ID: SESSION_ID, AI1_FORK_COMMAND: 'ignored-env-opener' };
  const forkResult = forkFullConversation({ environment, cwd: '/repo', host: detectForkHost({}, 'linux'), task: 'Try the other approach', openCommand: 'opener {mode} {original_session_id} {session_id} {task_file} {title}', runCommand: fakeRunner.runCommand });
  assert.equal(fakeRunner.callsOf('claude').length, 0, 'the command seeds the fork with its own launcher');
  const commandText = fakeRunner.callsOf('sh')[0].programArguments[1];
  const taskFile = /'(\/[^']+message\.md)'/.exec(commandText)[1];
  assert.equal(commandText, `opener 'full' '${SESSION_ID}' '${forkResult.sessionId}' '${taskFile}' 'Fork: 11111111'`, '--open-command wins over AI1_FORK_COMMAND');
  assert.equal(readFileSync(taskFile, 'utf8'), 'Try the other approach');
  assert.equal(forkResult.opened, 'command');
  // without an opener the seed goes through --claude-command
  const seedRunner = createFakeRunner();
  forkFullConversation({ environment: { CLAUDE_CODE_SESSION_ID: SESSION_ID }, cwd: '/repo', host: detectForkHost({}, 'linux'), claudeCommand: '/opt/bin/claude-wrapper --quiet', runCommand: seedRunner.runCommand });
  assert.deepEqual(seedRunner.callsOf('/opt/bin/claude-wrapper')[0].programArguments.slice(0, 4), ['--quiet', '-p', '--resume', SESSION_ID]);
});

test('a failing opener command is an error with its last lines and, for a brief, the built-in ways to open it [fork-without-paseo:S2]', () => {
  const failingRunner = createFakeRunner({ failing: 'sh -c' });
  assert.throws(() => startBriefConversation({ environment: {}, cwd: '/repo', host: detectForkHost({}, 'linux'), briefPath: writeBrief(), openCommand: 'broken', runCommand: failingRunner.runCommand }), /fork opener command failed \(exit 2\): boom\nopen it instead with:\n  terminal: claude/);
});

test('ai1 fork without an opener that only gives commands points to the guided setup [fork-without-paseo:S3]', () => {
  const outputLines = [];
  const commandArguments = ['brief', '--file', writeBrief()];
  const readOption = (optionName) => (commandArguments.includes(optionName) ? commandArguments[commandArguments.indexOf(optionName) + 1] : undefined);
  runForkCommand('/repo', commandArguments, { readOption, environment: {}, runCommand: createFakeRunner().runCommand, platformName: 'linux', writeOutput: (outputText) => outputLines.push(outputText) });
  assert.match(outputLines.join('\n'), /note: to have forks open in another tool, see "Open forks in another tool"/);
});

test('ai1 fork --opener reaches the host and an unknown value prints a note', () => {
  const outputLines = [];
  const commandArguments = ['host', '--opener', 'vscode'];
  const readOption = (optionName) => { const optionIndex = commandArguments.indexOf(optionName); return optionIndex >= 0 ? commandArguments[optionIndex + 1] : undefined; };
  runForkCommand('/repo', commandArguments, { readOption, environment: {}, runCommand: createFakeRunner().runCommand, platformName: 'linux', writeOutput: (outputText) => outputLines.push(outputText) });
  assert.match(outputLines.join('\n'), /host: vscode \(fork opener "vscode" \(detected: terminal\)\)/);
  const badArguments = ['host', '--opener', 'nope'];
  const badLines = [];
  runForkCommand('/repo', badArguments, { readOption: (optionName) => badArguments[badArguments.indexOf(optionName) + 1], environment: {}, runCommand: createFakeRunner().runCommand, platformName: 'linux', writeOutput: (outputText) => badLines.push(outputText) });
  assert.match(badLines[0], /^note: unknown fork opener "nope"/);
});

test('a real opener script gets the placeholders as positional arguments, in the documented order, quotes intact [fork-without-paseo:S4]', () => {
  const scriptDirectory = mkdtempSync(join(tmpdir(), 'ai1-opener-'));
  const scriptPath = join(scriptDirectory, 'opener.sh');
  writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s|" "$1" "$2" "$3" "$4" "$5" "$6" "$7"\n', { mode: 0o755 });
  const briefPath = writeBrief("# It's the login\nbody");
  const briefResult = startBriefConversation({
    environment: {}, cwd: scriptDirectory, host: detectForkHost({}, 'linux'), briefPath,
    openCommand: `${scriptPath} {mode} {cwd} {title} {brief_file} {task_file} {original_session_id} {session_id}`,
  });
  assert.equal(briefResult.output, `brief|${scriptDirectory}|It's the login|${briefPath}||||`);
});
