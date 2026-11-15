// `ai1 okf ...`: the OKF toolkit's scripts (validate, init, visualize, file-map), called by the
// okf skills and by hand. The logic lives in src/okf/; the okf-upkeep hook imports the same validator.

import { runOkfValidateCommand, OKF_VALIDATE_USAGE } from '../okf/okf-validate.mjs';
import { runOkfInitCommand, OKF_INIT_USAGE } from '../okf/okf-init.mjs';
import { runOkfVisualizeCommand, OKF_VISUALIZE_USAGE } from '../okf/okf-visualize.mjs';
import { runOkfFileMapCommand, OKF_FILE_MAP_USAGE } from '../okf/okf-file-map.mjs';

export const OKF_USAGE = `${OKF_VALIDATE_USAGE} | ${OKF_INIT_USAGE} | ${OKF_VISUALIZE_USAGE} | ${OKF_FILE_MAP_USAGE}`;

// Prints the result and returns the exit code.
export function runOkfCommand(commandArguments) {
  const [subcommandName, ...subcommandArguments] = commandArguments;
  if (subcommandName === 'validate') return runOkfValidateCommand(subcommandArguments);
  if (subcommandName === 'init') return runOkfInitCommand(subcommandArguments);
  if (subcommandName === 'visualize') return runOkfVisualizeCommand(subcommandArguments);
  if (subcommandName === 'file-map') return runOkfFileMapCommand(process.cwd(), subcommandArguments);
  console.error(`usage: ${OKF_USAGE}`);
  return 2;
}
