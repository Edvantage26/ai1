// Splits a subcommand's arguments into positional words and `--options`: the names in `valueOptions`
// take the next word as their value, any other `--flag` is true.
export function splitCommandArguments(commandArguments, valueOptions) {
  const positionalArguments = [];
  const optionValues = {};
  for (let argumentIndex = 0; argumentIndex < commandArguments.length; argumentIndex += 1) {
    const commandArgument = commandArguments[argumentIndex];
    if (valueOptions.has(commandArgument)) {
      optionValues[commandArgument] = commandArguments[argumentIndex + 1];
      argumentIndex += 1;
    } else if (commandArgument.startsWith('--')) optionValues[commandArgument] = true;
    else positionalArguments.push(commandArgument);
  }
  return { positionalArguments, optionValues };
}
