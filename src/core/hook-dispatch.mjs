// Runs every enabled module for one hook event and combines their decisions.
// Internal failures never block the agent (fail open); a module that matched a rule does.
// Decides with module metadata (MODULE_INDEX) and runs only the modules the caller loaded, so the
// hook entry point can import just the modules of its event.

import { combineDecisions, buildHookOutput, contextDecision, allowDecision } from './hook-io.mjs';
import { loadHarnessConfig, isModuleEnabled, getModuleOptions, CONFIG_RELATIVE_PATH } from './config.mjs';
import { resolveProjectRoots } from './project-roots.mjs';
import { MODULE_INDEX, KNOWN_MODULE_IDS, modulesForEvent } from './module-index.mjs';
import { hasLegacyLayout } from './legacy-layout.mjs';
import { appendDecisionLog, decisionCharacters, errorSignature } from './decision-log.mjs';
import { recordPendingErrors } from './pending-errors.mjs';

// Permission modes where the person chose not to be asked (bypass, auto): only the asks that guard
// against losing work or data for good (danger) and the repo's own rules (repo-rules) still reach
// them; the other modules' asks (config-guard, test-guard, sizing-gate scripts) let the call through.
const UNATTENDED_PERMISSION_MODES = new Set(['bypassPermissions', 'auto', 'dontAsk']);
const ASKS_KEPT_UNATTENDED = new Set(['danger', 'repo-rules']);

export function relaxAskForPermissionMode(moduleId, moduleDecision, permissionMode) {
  if (moduleDecision?.kind !== 'ask' || !UNATTENDED_PERMISSION_MODES.has(permissionMode) || ASKS_KEPT_UNATTENDED.has(moduleId)) return moduleDecision;
  return { ...allowDecision(), relaxedAsk: true };
}

// moduleDefinitions: metadata of every module (what `enabledModules` lists); runnableModules: the
// loaded modules of this event (an enabled module that was not loaded is skipped).
// migrationNotice: what the session-start migrations changed (src/core/migrations.mjs), told to the agent.
export function dispatchHookEvent(eventName, hookInput, { environment = process.env, homeDirectory, moduleDefinitions = MODULE_INDEX, runnableModules, reportInternalError = defaultErrorReporter, migrationNotice = null } = {}) {
  const { projectRoot, sharedRoot } = resolveProjectRoots(hookInput, environment);
  // A worktree reads the .ai1/config.json of its own branch; one without it (e.g. never committed) uses the main checkout's.
  let loadedConfig = loadHarnessConfig(projectRoot, KNOWN_MODULE_IDS);
  if (loadedConfig.status === 'missing' && sharedRoot !== projectRoot) loadedConfig = loadHarnessConfig(sharedRoot, KNOWN_MODULE_IDS);

  if (loadedConfig.status === 'missing') {
    // Inactive without a contract: one line at session start so the agent can mention it, nothing else.
    if (eventName !== 'SessionStart') return null;
    if (hasLegacyLayout(sharedRoot)) return buildHookOutput(eventName, contextDecision('setup', `ai1 plugin is installed but inactive here: no ${CONFIG_RELATIVE_PATH}, but the repo has the old layout (.claude/jig.json, .okf/, docs/rfc/ or .jig/work/). Tell the person that /ai1:core-setup-repo moves it to .ai1/.`));
    return buildHookOutput(eventName, contextDecision('setup', `ai1 plugin is installed but inactive here: no ${CONFIG_RELATIVE_PATH}. To set it up, the person can run /ai1:core-setup-repo.`));
  }
  if (loadedConfig.status === 'invalid') {
    reportInternalError(`invalid ${loadedConfig.configPath}: ${loadedConfig.errors.join('; ')}`);
    if (eventName !== 'SessionStart') return null;
    return buildHookOutput(eventName, contextDecision('setup', `ai1 is inactive because ${CONFIG_RELATIVE_PATH} is invalid: ${loadedConfig.errors.join('; ')}. Tell the person so it can be fixed.`));
  }

  const { config } = loadedConfig;
  const enabledModules = moduleDefinitions.filter((moduleDefinition) => isModuleEnabled(moduleDefinition, config));
  const runnableById = new Map(runnableModules.map((runnableModule) => [runnableModule.id, runnableModule]));
  const eventModules = modulesForEvent(eventName, hookInput.tool_name, enabledModules)
    .map((moduleDefinition) => runnableById.get(moduleDefinition.id))
    .filter(Boolean);
  const moduleDecisions = [];
  const logEntries = [];
  for (const moduleDefinition of eventModules) {
    const startedAt = performance.now();
    let moduleDecision;
    try {
      moduleDecision = moduleDefinition.run({
        hookInput,
        config,
        projectRoot,
        sharedRoot,
        environment,
        homeDirectory,
        enabledModules,
        moduleOptions: getModuleOptions(moduleDefinition.id, config),
      });
      moduleDecision = relaxAskForPermissionMode(moduleDefinition.id, moduleDecision, hookInput.permission_mode);
      moduleDecisions.push(moduleDecision);
    } catch (moduleError) {
      moduleDecision = { kind: 'error', error: errorSignature(moduleError) };
      reportInternalError(`module ${moduleDefinition.id} failed: ${moduleError.stack || moduleError}`);
    }
    logEntries.push({
      at: new Date().toISOString(),
      session: hookInput.session_id,
      event: eventName,
      tool: hookInput.tool_name,
      module: moduleDefinition.id,
      decision: moduleDecision?.kind || 'allow',
      ms: Math.round((performance.now() - startedAt) * 100) / 100,
      chars: decisionCharacters(moduleDecision),
      ...(hookInput.tool_use_id ? { toolUse: hookInput.tool_use_id } : {}),
      ...(moduleDecision?.ruleIds ? { rules: moduleDecision.ruleIds } : {}),
      ...(moduleDecision?.error ? { error: moduleDecision.error } : {}),
      ...(moduleDecision?.relaxedAsk ? { relaxedAsk: hookInput.permission_mode } : {}),
    });
  }
  appendDecisionLog(logEntries, sharedRoot, environment);
  recordPendingErrors(logEntries.filter((logEntry) => logEntry.decision === 'error'), sharedRoot, environment);
  if (migrationNotice && eventName === 'SessionStart') moduleDecisions.push(contextDecision('migrations', migrationNotice));
  for (const configNotice of loadedConfig.notices) {
    reportInternalError(configNotice);
    if (eventName === 'SessionStart') moduleDecisions.push(contextDecision('setup', configNotice));
  }
  if (loadedConfig.unknownEntries.length) {
    const unknownText = loadedConfig.unknownEntries.join(', ');
    reportInternalError(`${loadedConfig.configPath} mentions ${unknownText}, unknown to this ai1 version; ignored`);
    if (eventName === 'SessionStart') {
      moduleDecisions.push(contextDecision('setup', `${CONFIG_RELATIVE_PATH} mentions ${unknownText}, which this ai1 version does not know; they are ignored and the rest of ai1 works. Tell the person to update the ai1 plugin.`));
    }
  }
  return buildHookOutput(eventName, combineDecisions(moduleDecisions));
}

function defaultErrorReporter(errorMessage) {
  // stderr with exit 0 is only shown in verbose mode: visible for debugging, silent for the agent.
  process.stderr.write(`ai1: ${errorMessage}\n`);
}
