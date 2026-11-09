// The bundled OKF validator (Python, skills/okf-validate-bundle), run by okf-upkeep when the session
// changed the bundle and by `ai1 worktree finish`. A missing python3 fails open.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BUNDLED_VALIDATOR_SCRIPT = fileURLToPath(new URL('../../skills/okf-validate-bundle/scripts/okf_validate.py', import.meta.url));
const VALIDATOR_TIMEOUT_MILLISECONDS = 10000;
const MAX_LISTED_ERRORS = 15;

// Runs the bundled OKF validator. Returns { ran: true, errors } or { ran: false, reason }.
// AI1_PYTHON / AI1_OKF_VALIDATOR override the interpreter and the script (used by tests).
export function runBundleValidator(bundleDirectory, environment = process.env) {
  const pythonCommand = environment.AI1_PYTHON || 'python3';
  const validatorScript = environment.AI1_OKF_VALIDATOR || BUNDLED_VALIDATOR_SCRIPT;
  let validatorOutput;
  try {
    validatorOutput = execFileSync(pythonCommand, [validatorScript, bundleDirectory, '--json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: VALIDATOR_TIMEOUT_MILLISECONDS,
    });
  } catch (validatorFailure) {
    // The validator exits non-zero when the bundle has errors; its JSON is still on stdout.
    validatorOutput = validatorFailure.stdout;
    if (!validatorOutput) return { ran: false, reason: validatorFailure.code === 'ENOENT' ? `${pythonCommand} not found` : String(validatorFailure.message).split('\n')[0] };
  }
  try {
    const validationReport = JSON.parse(validatorOutput);
    return { ran: true, errors: Array.isArray(validationReport.errors) ? validationReport.errors : [] };
  } catch {
    return { ran: false, reason: 'validator output is not JSON' };
  }
}

export function buildValidationReminder(bundleRelativePath, validationErrors) {
  return [
    `OKF: the bundle at ${bundleRelativePath}/ was changed in this session and the validator reports ${validationErrors.length} ERROR(s) (warnings are not shown and do not block):`,
    ...validationErrors.slice(0, MAX_LISTED_ERRORS).map((validationError) => `  - ${validationError}`),
    ...(validationErrors.length > MAX_LISTED_ERRORS ? [`  - ... and ${validationErrors.length - MAX_LISTED_ERRORS} more (run /ai1:okf-validate-bundle ${bundleRelativePath})`] : []),
    'Fix every error, then finish.',
  ].join('\n');
}
