// YAML for OKF frontmatter, read the way the Python toolkit (PyYAML safe_load) read it, so the
// validator's verdicts did not move when it was ported to Node. js-yaml is vendored (vendor/js-yaml).
// Differences kept on purpose, from PyYAML's YAML 1.1:
//   - timestamps stay as their text (PyYAML built datetimes; the checks only test the text shape);
//   - booleans include yes/no/on/off, as in YAML 1.1;
//   - a duplicate key keeps the last value instead of failing;
//   - octal (0777) and base-60 (1:30) numbers are not copied: no OKF field is numeric that way.
// pythonText(value) prints a value as Python's str() did, for the messages that quote one.

import { load, FAILSAFE_SCHEMA, Type, types } from '../../vendor/js-yaml/js-yaml.mjs';

const YAML11_BOOLEAN_PATTERN = /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
const YAML11_TRUE_WORDS = new Set(['yes', 'true', 'on']);

const yaml11BooleanType = new Type('tag:yaml.org,2002:bool', {
  kind: 'scalar',
  resolve: (scalarText) => scalarText !== null && YAML11_BOOLEAN_PATTERN.test(scalarText),
  construct: (scalarText) => YAML11_TRUE_WORDS.has(scalarText.toLowerCase()),
  predicate: (value) => typeof value === 'boolean',
  represent: { lowercase: (value) => (value ? 'true' : 'false') },
  defaultStyle: 'lowercase',
});

const OKF_YAML_SCHEMA = FAILSAFE_SCHEMA.extend({
  implicit: [types.null, yaml11BooleanType, types.int, types.float, types.merge],
  explicit: [types.binary, types.omap, types.pairs, types.set],
});

// Parses YAML text; throws js-yaml's YAMLException when it is not valid YAML.
export function loadOkfYaml(yamlText) {
  return load(yamlText, { schema: OKF_YAML_SCHEMA, json: true });
}

export function isYamlMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The value of a key the mapping really has (not one inherited from Object.prototype).
export function readOwnField(mapping, fieldName) {
  return isYamlMapping(mapping) && Object.hasOwn(mapping, fieldName) ? mapping[fieldName] : undefined;
}

// mapping.get(fieldName, defaultValue) in Python: a key present with a null value gives null.
export function readOwnFieldOr(mapping, fieldName, defaultValue) {
  return isYamlMapping(mapping) && Object.hasOwn(mapping, fieldName) ? mapping[fieldName] : defaultValue;
}

function pythonRepr(value) {
  if (typeof value === 'string') return value.includes("'") && !value.includes('"') ? `"${value}"` : `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  return pythonText(value);
}

// str() of a value as PyYAML would have built it: None/True/False, lists and dicts in repr form.
export function pythonText(value) {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'nan';
    if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(pythonRepr).join(', ')}]`;
  if (isYamlMapping(value)) return `{${Object.entries(value).map(([key, entryValue]) => `${pythonRepr(key)}: ${pythonRepr(entryValue)}`).join(', ')}}`;
  return String(value);
}

// "{text}".strip() in Python for any YAML value.
export function strippedPythonText(value) {
  return pythonText(value).trim();
}
