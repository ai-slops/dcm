const settingNames = ["STUDIO_AGENT_PROVIDER", "STUDIO_AGENT_MODEL", "DIM_LLM_ROUTER_CONNECTION_FILE"];

export function providerSettings(environment) {
  return Object.fromEntries(settingNames.filter(name => typeof environment[name] === "string").map(name => [name, environment[name]]));
}

export function withProviderSettings(environment, state) {
  return { ...providerSettings(state?.provider_settings ?? {}), ...environment };
}

export function sameProviderSettings(state, environment) {
  return JSON.stringify(providerSettings(state?.provider_settings ?? {})) === JSON.stringify(providerSettings(environment));
}
