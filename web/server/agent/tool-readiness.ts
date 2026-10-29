import type { Bootstrap } from "../../shared/index.ts"

type Readiness = { readonly ready: boolean; readonly message: string }

export function agentToolReadiness(input: {
  readonly native: Readiness
  readonly projects: Readiness
  readonly generatorCompatible: boolean
}): NonNullable<Bootstrap["tools"]> {
  const nativeReason = input.native.ready ? {} : { reason: input.native.message }
  return [
    { id: "read_document", description: "Read the frozen saved project.", available: true },
    {
      id: "evaluate_chart",
      description: "Evaluate the frozen chart with the native finite model.",
      available: input.native.ready,
      ...nativeReason,
    },
    { id: "list_projects", description: "List live durable project summaries.", available: true },
    {
      id: "list_songs",
      description: "List song IDs available for project creation.",
      available: true,
    },
    { id: "read_project", description: "Read one live durable project.", available: true },
    {
      id: "list_base_sources",
      description: "List exact base timing references for an existing song.",
      available: true,
    },
    { id: "read_chart", description: "Read one saved chart document by ID.", available: true },
    {
      id: "create_project",
      description: "Create a project with explicit run write access.",
      available: true,
    },
    {
      id: "write_project",
      description: "CAS-update project rules with explicit run write access.",
      available: true,
    },
    {
      id: "generate_project",
      description: "Persist a new inactive result chart without replacing the editor.",
      available: input.projects.ready,
      ...(input.projects.ready ? {} : { reason: input.projects.message }),
    },
    {
      id: "publish_component",
      description: "Publish a reusable component with explicit run write access.",
      available: true,
    },
    {
      id: "apply_component",
      description: "CAS-apply a component with explicit run write access.",
      available: true,
    },
    { id: "list_components", description: "List live component summaries.", available: true },
    { id: "read_component", description: "Read one live reusable component.", available: true },
    {
      id: "generate_variant",
      description: "Generate a native candidate chart.",
      available: input.generatorCompatible,
      ...(input.generatorCompatible
        ? {}
        : {
            reason: input.native.ready
              ? "Current timing/audio differs from the bundled generator profile"
              : input.native.message,
          }),
    },
    {
      id: "propose_chart",
      description: "Create a reviewable chart and timing proposal.",
      available: true,
    },
    {
      id: "validate_ucs",
      description: "Validate native UCS export for the frozen project.",
      available: input.native.ready,
      ...nativeReason,
    },
  ]
}
