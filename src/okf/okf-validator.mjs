// The OKF validator (src/okf/okf-validate.mjs, also `ai1 okf validate`), run in-process by okf-upkeep
// when the session changed the bundle and by `ai1 worktree finish`. A crash of the validator itself
// fails open: okf-upkeep tells the person once per session that the bundle was not validated.

import { validateOkfBundle } from './okf-validate.mjs';

const MAX_LISTED_ERRORS = 15;

// { ran: true, errors } or { ran: false, reason } when the validator threw.
export function runBundleValidator(bundleDirectory, validateBundle = validateOkfBundle) {
  try {
    return { ran: true, errors: validateBundle(bundleDirectory).errors };
  } catch (validatorFailure) {
    return { ran: false, reason: `the validator failed (${String(validatorFailure?.message || validatorFailure).split('\n')[0]})` };
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
