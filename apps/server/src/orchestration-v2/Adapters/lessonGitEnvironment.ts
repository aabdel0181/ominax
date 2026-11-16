const GIT_CONFIG_COUNT = "GIT_CONFIG_COUNT";
const GIT_CONFIG_KEY = "GIT_CONFIG_KEY_";
const GIT_CONFIG_VALUE = "GIT_CONFIG_VALUE_";

/** Appends Git's protocol deny rule without replacing provider configuration. */
export function withLessonGitNetworkBlocked(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const configuredCount = Number.parseInt(environment[GIT_CONFIG_COUNT] ?? "", 10);
  const configuredIndexes = Object.keys(environment)
    .filter((key) => key.startsWith(GIT_CONFIG_KEY))
    .map((key) => Number.parseInt(key.slice(GIT_CONFIG_KEY.length), 10))
    .filter((index) => Number.isInteger(index) && index >= 0);
  const nextIndex = Math.max(
    Number.isInteger(configuredCount) && configuredCount >= 0 ? configuredCount : 0,
    ...(configuredIndexes.length === 0 ? [0] : [Math.max(...configuredIndexes) + 1]),
  );
  return {
    ...environment,
    [GIT_CONFIG_COUNT]: String(nextIndex + 1),
    [`${GIT_CONFIG_KEY}${nextIndex}`]: "protocol.allow",
    [`${GIT_CONFIG_VALUE}${nextIndex}`]: "never",
  };
}
