import { describe, expect, it } from "vitest"

import { ProjectAgentTools } from "../../server/agent/project-tools.ts"
import type {
  GenerationProject,
  ProjectWorkspace,
  ReusableComponent,
} from "../../shared/generation-projects.ts"
import type { ProjectMutation } from "../../shared/project-commands.ts"
import {
  fullProject,
  generationMutation,
  PROJECT_ID,
  projectMutation,
  workspace,
} from "../support/agent-project-fixtures.ts"

describe("agent project tools", () => {
  it("denies a write before calling the project service when access is read-only", async () => {
    // Given
    let commands = 0
    const tools = new ProjectAgentTools({
      service: fakeService(() => {
        commands += 1
        return projectMutation()
      }),
      writeAccess: "read_only",
      signal: new AbortController().signal,
      onMutation: () => undefined,
    })

    // When / Then
    await expect(tools.writeProject(writeInput())).rejects.toMatchObject({
      code: "agent_write_denied",
    })
    expect(commands).toBe(0)
  })

  it("returns a bounded receipt after an allowed durable write", async () => {
    // Given
    let mutations = 0
    const tools = new ProjectAgentTools({
      service: fakeService(() => projectMutation()),
      writeAccess: "projects_and_components",
      signal: new AbortController().signal,
      onMutation: () => {
        mutations += 1
      },
    })

    // When
    const receipt = await tools.writeProject(writeInput())

    // Then
    expect(receipt).toEqual({
      status: "persisted",
      workspace_revision: 2,
      entity: { kind: "project", id: PROJECT_ID, revision: 2 },
    })
    expect(Buffer.byteLength(JSON.stringify(receipt), "utf8")).toBeLessThan(512)
    expect(mutations).toBe(1)
  })

  it("rejects an aborted queued write before the project service transaction", async () => {
    // Given
    let commands = 0
    const abort = new AbortController()
    abort.abort("cancelled")
    const tools = new ProjectAgentTools({
      service: fakeService(() => {
        commands += 1
        return projectMutation()
      }),
      writeAccess: "projects_and_components",
      signal: abort.signal,
      onMutation: () => undefined,
    })

    // When / Then
    await expect(tools.writeProject(writeInput())).rejects.toMatchObject({ code: "run_cancelled" })
    expect(commands).toBe(0)
  })

  it("summarizes generated chart evidence without returning the full assessment", async () => {
    // Given
    const tools = new ProjectAgentTools({
      service: fakeService(() => generationMutation()),
      writeAccess: "projects_and_components",
      signal: new AbortController().signal,
      onMutation: () => undefined,
    })

    // When
    const receipt = await tools.generateProject({
      project_id: fullProject().id,
      base_revision: fullProject().revision,
      name: "Generated",
      seed: "0".repeat(64),
    })

    // Then
    expect(receipt).toMatchObject({
      entity: { kind: "chart", id: "00000000-0000-4000-8000-000000000003" },
      generation: {
        accepted: false,
        rejection_count: 1,
        mode: "Single",
        note_count: 2,
        source_project_revision: 1,
        seed: "0".repeat(64),
      },
    })
    expect(JSON.stringify(receipt)).not.toContain("execution")
    expect("revision" in receipt.entity).toBe(false)
  })
})

function writeInput() {
  const project = fullProject()
  return {
    project_id: project.id,
    base_revision: project.revision,
    name: project.name,
    timing: project.timing,
    evaluation_contract: project.evaluation_contract,
    generation_rules: project.generation_rules,
  }
}

function fakeService(command: () => ProjectMutation) {
  return {
    list: (): ProjectWorkspace => workspace(),
    songs: () => [],
    chart: () => {
      throw new TypeError("not expected")
    },
    read: (): GenerationProject => fullProject(),
    component: (): ReusableComponent => {
      throw new TypeError("not expected")
    },
    command: async () => command(),
  }
}
