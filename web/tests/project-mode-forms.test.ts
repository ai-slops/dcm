import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { RevisionSchema } from "../shared/api.ts"
import { BeatProjectWorkspaceSchema } from "../shared/beat-projects.ts"
import {
  LibraryRevisionSchema,
  LibrarySnapshotSchema,
  LibrarySongSchema,
} from "../shared/library.ts"
import { GenerationProjectIdSchema } from "../shared/project-identities.ts"
import { LibraryNewSongForm } from "../src/ui/LibraryNewSongForm.tsx"
import { ProjectEditorForm } from "../src/ui/ProjectEditorForm.tsx"
import { ProjectWorkspaceList } from "../src/ui/ProjectWorkspaceList.tsx"

it("requires an explicit mode before creating a song and its first chart", () => {
  // Given a new-song form with no prior chart mode to inherit
  // When it renders for first use
  const markup = renderToStaticMarkup(
    createElement(LibraryNewSongForm, {
      busy: false,
      libraryRevision: LibraryRevisionSchema.parse(0),
      documentRevision: RevisionSchema.parse(0),
      onCreate: () => undefined,
    }),
  )

  // Then mode is required and starts on a non-submittable placeholder
  expect(markup).toContain('select required=""')
  expect(markup).toContain('<option value="" selected="">Choose mode</option>')
})

it("requires selected-song timing before creating a rule project", () => {
  // Given
  const song = LibrarySongSchema.parse({
    id: "00000000-0000-4000-8000-000000000002",
    title: "Song",
    artist: "Artist",
    audio: { format: "wav", byte_length: 0, sha256: "0".repeat(64) },
  })

  // When
  const markup = renderToStaticMarkup(
    createElement(ProjectEditorForm, {
      busy: false,
      library: librarySnapshot(song),
      project: null,
      onDirtyChange: () => undefined,
      onLoadBase: () => Promise.reject(new TypeError("not called during server render")),
      onLoadBaseSources: () => Promise.resolve([]),
      onCreate: () => undefined,
      onWrite: () => undefined,
    }),
  )

  // Then
  expect(markup).toContain("Duration starts automatic")
  expect(markup).toContain("no chart is selected implicitly")
  expect(markup).toContain("Base timing source")
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Create project/s)
})

it("locks every rule field and project inspection control during a mutation", () => {
  // Given
  const song = LibrarySongSchema.parse({
    id: "00000000-0000-4000-8000-000000000002",
    title: "Song",
    artist: "Artist",
    audio: { format: "wav", byte_length: 0, sha256: "0".repeat(64) },
  })
  const workspace = BeatProjectWorkspaceSchema.parse({
    revision: 1,
    selected_project_id: "00000000-0000-4000-8000-000000000001",
    projects: [
      {
        schema_version: 2,
        id: "00000000-0000-4000-8000-000000000001",
        revision: 2,
        name: "Rules",
        song_id: song.id,
        mode: "Double",
        chart_artist: "Stepper",
        base_ucs_ref: null,
        applied_components: {},
      },
    ],
    components: [],
  })

  // When
  const form = renderToStaticMarkup(
    createElement(ProjectEditorForm, {
      busy: true,
      library: librarySnapshot(song),
      project: null,
      onDirtyChange: () => undefined,
      onLoadBase: () => Promise.reject(new TypeError("not called during server render")),
      onLoadBaseSources: () => Promise.resolve([]),
      onCreate: () => undefined,
      onWrite: () => undefined,
    }),
  )
  const list = renderToStaticMarkup(
    createElement(ProjectWorkspaceList, {
      busy: true,
      workspace,
      inspectedId: null,
      rulesDirty: false,
      onInspect: () => undefined,
      onSelect: () => undefined,
      onDelete: () => undefined,
      onNew: () => undefined,
    }),
  )

  // Then
  expect(form).toContain('<fieldset class="project-editor__fields" disabled="">')
  expect(list).toMatch(/<button[^>]*class="project-list__inspect"[^>]*disabled=""/)
  expect(list).not.toContain("Edit grid")
})

it("links a saved clean project to its visual grid editor", async () => {
  // Given
  const project = await projectFixtureForLink()

  // When
  const markup = renderToStaticMarkup(
    createElement(ProjectWorkspaceList, {
      busy: false,
      rulesDirty: false,
      workspace: project.workspace,
      inspectedId: project.id,
      onInspect: () => undefined,
      onSelect: () => undefined,
      onDelete: () => undefined,
      onNew: () => undefined,
    }),
  )

  // Then
  expect(markup).toContain(`href="/projects/${project.id}/edit"`)
  expect(markup).toContain("Edit grid")
})

async function projectFixtureForLink() {
  const id = GenerationProjectIdSchema.parse("00000000-0000-4000-8000-000000000001")
  return {
    id,
    workspace: BeatProjectWorkspaceSchema.parse({
      revision: 1,
      selected_project_id: id,
      projects: [
        {
          schema_version: 2,
          id,
          revision: 2,
          name: "Rules",
          song_id: "00000000-0000-4000-8000-000000000002",
          mode: "Double",
          chart_artist: "Stepper",
          base_ucs_ref: null,
          applied_components: {},
        },
      ],
      components: [],
    }),
  }
}

function librarySnapshot(song: ReturnType<typeof LibrarySongSchema.parse>) {
  return LibrarySnapshotSchema.parse({
    revision: 1,
    active_chart_id: "00000000-0000-4000-8000-000000000005",
    songs: [song],
    charts: [],
    archives: [],
  })
}
