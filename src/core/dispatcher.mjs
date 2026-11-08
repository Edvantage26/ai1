// Runs every enabled module for one hook event and combines their decisions.
// Internal failures never block the agent (fail open); a module that matched a rule does.

import { combineDecisions, buildHookOutput, contextDecision } from './hook-io.mjs';
import { loadHarnessConfig, isModuleEnabled, getModuleOptions, CONFIG_RELATIVE_PATH } from './config.mjs';
import { resolveProjectRoots } from './project-roots.mjs';
import { ALL_MODULES, KNOWN_MODULE_IDS, modulesForEvent } from './registry.mjs';

export function runHookEvent(eventName, hookInput, { environment = process.env, homeDirectory, availableModules = ALL_MODULES, reportInternalError = defaultErrorReporter } = {}) {
  const { projectRoot, sharedRoot } = resolveProjectRoots(hookInput, environment);
  // A worktree reads the jig.json of its own branch; one without it (e.g. never committed) uses the main checkout's.
  let loadedConfig = loadHarnessConfig(projectRoot, KNOWN_MODULE_IDS);
  if (loadedConfig.status === 'missing' && sharedRoot !== projectRoot) loadedConfig = loadHarnessConfig(sharedRoot, KNOWN_MODULE_IDS);

  if (loadedConfig.status === 'missing') {
    // Inactive without a contract: one line at session start so the agent can mention it, nothing else.
    if (eventName !== 'SessionStart') return null;
    return buildHookOutput(eventName, contextDecision('setup', `jig plugin is installed but inactive here: no ${CONFIG_RELATIVE_PATH}. To set it up, the person can run /jig:init.`));
  }
  if (loadedConfig.status === 'invalid') {
    reportInternalError(`invalid ${loadedConfig.configPath}: ${loadedConfig.errors.join('; ')}`);
    if (eventName !== 'SessionStart') return null;
    return buildHookOutput(eventName, contextDecision('setup', `jig is inactive because ${CONFIG_RELATIVE_PATH} is invalid: ${loadedConfig.errors.join('; ')}. Tell the person so it can be fixed.`));
  }

  const { config } = loadedConfig;
  const enabledModules = availableModules.filter((moduleDefinition) => isModuleEnabled(moduleDefinition, config));
  const eventModules = modulesForEvent(eventName, hookInput.tool_name, enabledModules);
  const moduleDecisions = [];
  for (const moduleDefinition of eventModules) {
    try {
      moduleDecisions.push(moduleDefinition.run({
        hookInput,
        config,
        projectRoot,
        sharedRoot,
        environment,
        homeDirectory,
        enabledModules,
        moduleOptions: getModuleOptions(moduleDefinition.id, config),
      }));
    } catch (moduleError) {
      reportInternalError(`module ${moduleDefinition.id} failed: ${moduleError.stack || moduleError}`);
    }
  }
  if (loadedConfig.unknownEntries.length) {
    const unknownText = loadedConfig.unknownEntries.join(', ');
    reportInternalError(`${loadedConfig.configPath} mentions ${unknownText}, unknown to this jig version; ignored`);
    if (eventName === 'SessionStart') {
      moduleDecisions.push(contextDecision('setup', `${CONFIG_RELATIVE_PATH} mentions ${unknownText}, which this jig version does not know; they are ignored and the rest of jig works. Tell the person to update the jig plugin.`));
    }
  }
  return buildHookOutput(eventName, combineDecisions(moduleDecisions));
}

function defaultErrorReporter(errorMessage) {
  // stderr with exit 0 is only shown in verbose mode: visible for debugging, silent for the agent.
  process.stderr.write(`jig: ${errorMessage}\n`);
}
