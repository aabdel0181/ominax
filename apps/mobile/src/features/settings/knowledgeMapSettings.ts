import type { SettingsTarget } from "./settings-environment-filter";

export function knowledgeMapTargets(targets: readonly SettingsTarget[]): readonly SettingsTarget[] {
  return targets.filter(
    (target) => target.serverConfig.environment.capabilities.knowledgeMap === true,
  );
}
