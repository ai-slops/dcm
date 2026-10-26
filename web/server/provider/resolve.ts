import type { AgentProviderStatus, ProviderModel } from "../../shared/provider.ts"
import type { AgentConfiguration } from "../agent/runs.ts"
import type { StudioConfig } from "../config.ts"
import { StudioError } from "../errors.ts"
import { discoverDimRouter, ProviderDiscoveryError } from "./dim.ts"

export type ProviderResolution = {
  readonly status: AgentProviderStatus
  readonly configuration: AgentConfiguration | undefined
  readonly configurations: readonly AgentConfiguration[]
}

const runtime = "@slop-lab/part@0.1.0"

export async function resolveAgentProvider(config: StudioConfig): Promise<ProviderResolution> {
  switch (config.agentProvider) {
    case "off":
      return unavailable(
        "off",
        "Agent provider is disabled. Enable the workspace DIM provider explicitly; no new account key is needed.",
      )
    case "standalone": {
      if (config.part === undefined)
        return unavailable(
          "standalone",
          "Set PART_ENDPOINT and PART_MODEL on the server to use a standalone provider.",
        )
      const api = config.part.api ?? "chat"
      const configuration = { ...config.part, api }
      return {
        configuration,
        configurations: [configuration],
        status: {
          configured: true,
          provider: api === "responses" ? "openai-responses" : "openai-compatible",
          model: config.part.model,
          source: "standalone",
          api,
          runtime,
          message:
            "Standalone server-side provider. Chart tools never receive provider credentials.",
          models: [{ id: config.part.model, name: config.part.model, api }],
        },
      }
    }
    case "dim": {
      try {
        const connection = await discoverDimRouter(config.dimConnectionFile)
        const configurations: readonly AgentConfiguration[] = connection.models.map((model) => ({
          endpoint: new URL(
            model.api === "responses" ? "/v1/responses" : "/v1/chat/completions",
            connection.origin,
          ),
          model: model.id,
          api: model.api,
          apiKey: connection.token,
        }))
        const selected = selectConfiguration(configurations, config.agentModel)
        const selectedModel = connection.models.find((model) => model.id === selected?.model)
        return {
          configuration: selected,
          configurations,
          status: {
            configured: true,
            provider: "DIM workspace router",
            model: selected?.model ?? null,
            source: "dim",
            api: selectedModel?.api ?? null,
            runtime,
            message:
              selected === undefined
                ? "Workspace router connected. Select an available tool-capable text model; the route catalog declares its API, not tool quality."
                : "Workspace-scoped DIM connection. Model/API selected from the current route catalog; no account setup is duplicated.",
            models: connection.models,
          },
        }
      } catch (error) {
        return unavailable(
          "dim",
          error instanceof ProviderDiscoveryError
            ? error.message
            : "DIM router initialization failed; check the workspace connection.",
        )
      }
    }
  }
}

function selectConfiguration(
  configurations: readonly AgentConfiguration[],
  model?: string,
): AgentConfiguration | undefined {
  if (model !== undefined) return configurations.find((item) => item.model === model)
  return configurations.length === 1 ? configurations[0] : undefined
}

export async function configurationForModel(
  config: StudioConfig,
  modelId?: string,
): Promise<AgentConfiguration> {
  const resolved = await resolveAgentProvider(config)
  if (!resolved.status.configured)
    throw new StudioError(
      503,
      "agent_provider_unavailable",
      resolved.status.message ?? "Agent provider is unavailable",
    )
  const selected =
    modelId === undefined
      ? resolved.configuration
      : resolved.configurations.find((item) => item.model === modelId)
  if (selected === undefined)
    throw new StudioError(
      400,
      "agent_model_unavailable",
      "Select a model available in the current provider catalog",
    )
  return selected
}

function unavailable(source: "off" | "dim" | "standalone", message: string): ProviderResolution {
  const models: readonly ProviderModel[] = []
  return {
    configuration: undefined,
    configurations: [],
    status: {
      configured: false,
      provider: source === "dim" ? "DIM workspace router" : null,
      model: null,
      source,
      api: null,
      runtime,
      message,
      models,
    },
  }
}
