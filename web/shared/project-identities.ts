import { z } from "zod"

import { NonNegativeIntegerSchema } from "./native.ts"

export const GenerationProjectIdSchema = z.uuid().brand("GenerationProjectId")
export const ComponentIdSchema = z.uuid().brand("ComponentId")
export const ProjectRevisionSchema = NonNegativeIntegerSchema.brand("ProjectRevision")
export const WorkspaceRevisionSchema = NonNegativeIntegerSchema.brand("WorkspaceRevision")
export const ComponentKindSchema = z.enum(["timing", "evaluation", "generator"])
export const MAX_GENERATION_PROJECTS = 64
export const MAX_REUSABLE_COMPONENTS = 128

export type GenerationProjectId = z.infer<typeof GenerationProjectIdSchema>
export type ComponentId = z.infer<typeof ComponentIdSchema>
export type ProjectRevision = z.infer<typeof ProjectRevisionSchema>
export type ComponentKind = z.infer<typeof ComponentKindSchema>
