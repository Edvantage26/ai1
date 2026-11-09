// The bundled OKF validator (Python, skills/okf-validate-bundle), run by okf-upkeep when the session
// changed the bundle and by `ai1 worktree finish`. Python is optional for ai1: a missing one fails
// open, and okf-upkeep tells the person once per session that validation is off.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BUNDLED_VALIDATOR_SCRIPT = fileURLToPath(new URL('../../skills/okf-validate-bundle/scripts/okf_validate.py', import.meta.url));
const VALIDATOR_TIMEOUT_MILLISECONDS = 10000;
const MAX_LISTED_ERRORS = 15;
// `python3` on Linux and macOS; on Windows it is often missing (or the Store stub), so `python`
// and the `py -3` launcher follow. A candidate that prints no JSON (missing, Python 2) is skipped.
const DEFAULT_PYTHON_COMMANDS = [['python3'], ['python'], ['py', '-3']];

// The interpreters to try, each as [command, ...arguments]. AI1_PYTHON pins one (used by tests).
export function pythonCommandsFor(environment = process.env) {
  return environment.AI1_PYTHON ? [[environment.AI1_PYTHON]] : DEFAULT_PYTHON_COMMANDS;
}

// Runs the bundled OKF validator. Returns { ran: true, errors } or { ran: false, reason }.
// AI1_OKF_VALIDATOR overrides the script (used by tests).
export function runBundleValidator(bundleDirectory, environment = process.env, pythonCommands = pythonCommandsFor(environment)) {
  const validatorScript = environment.AI1_OKF_VALIDATOR || BUNDLED_VALIDATOR_SCRIPT;
  const failureReasons = [];
  for (const [pythonCommand, ...pythonArguments] of pythonCommands) {
    let validatorOutput;
    try {
      validatorOutput = execFileSync(pythonCommand, [...pythonArguments, validatorScript, bundleDirectory, '--json'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: VALIDATOR_TIMEOUT_MILLISECONDS,
      });
    } catch (validatorFailure) {
      // The validator exits non-zero when the bundle has errors; its JSON is still on stdout.
      validatorOutput = validatorFailure.stdout;
      if (!validatorOutput) {
        failureReasons.push(validatorFailure.code === 'ENOENT' ? `${pythonCommand} not found` : `${pythonCommand}: ${String(validatorFailure.message).split('\n')[0]}`);
        continue;
      }
    }
    try {
      const validationReport = JSON.parse(validatorOutput);
      return { ran: true, errors: Array.isArray(validationReport.errors) ? validationReport.errors : [] };
    } catch {
      failureReasons.push(`${pythonCommand}: validator output is not JSON`);
    }
  }
  return { ran: false, reason: `no Python 3 could run it (${failureReasons.join('; ')})` };
}

export function buildValidationReminder(bundleRelativePath, validationErrors) {
  return [
    `OKF: the bundle at ${bundleRelativePath}/ was changed in this session and the validator reports ${validationErrors.length} ERROR(s) (warnings are not shown and do not block):`,
    ...validationErrors.slice(0, MAX_LISTED_ERRORS).map((validationError) => `  - ${validationError}`),
    ...(validationErrors.length > MAX_LISTED_ERRORS ? [`  - ... and ${validationErrors.length - MAX_LISTED_ERRORS} more (run /ai1:okf-validate-bundle ${bundleRelativePath})`] : []),
    'Fix every error, then finish.',
  ].join('\n');
}
