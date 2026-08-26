import { z } from 'zod'
import { redactSensitiveValues } from '@/lib/safety'

const identifier = z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/, 'Identifiers must use lowercase letters, numbers, and hyphens.')
const label = z.string().trim().min(1).max(100)

const targetPlatform = z.enum(['web', 'ios', 'android', 'api'])
const targetSchema = z.object({
  platform: targetPlatform,
  framework: z.enum(['nextjs', 'expo']),
  enabled: z.boolean(),
}).strict()

const screenSchema = z.object({
  id: identifier,
  name: label,
  route: z.string().min(1).max(200).regex(/^\//, 'Screen routes must start with /.') ,
  kind: z.enum(['page', 'dashboard', 'collection', 'detail', 'form', 'settings']),
  access: z.array(identifier).max(20),
}).strict()

const fieldSchema = z.object({
  id: identifier,
  name: label,
  type: z.enum(['text', 'number', 'boolean', 'date', 'datetime', 'email', 'url', 'image', 'file', 'relation', 'json']),
  required: z.boolean(),
  relationEntityId: identifier.optional(),
}).strict()

const entitySchema = z.object({
  id: identifier,
  name: label,
  fields: z.array(fieldSchema).max(100),
}).strict()

const roleSchema = z.object({ id: identifier, name: label }).strict()
const permissionSchema = z.object({
  roleId: identifier,
  resource: identifier,
  actions: z.array(z.enum(['create', 'read', 'update', 'delete', 'manage'])).min(1).max(5),
}).strict()

const workflowTriggerSchema = z.object({
  type: z.enum(['form', 'button', 'schedule', 'webhook', 'data-change']),
  screenId: identifier.optional(),
}).strict()

const workflowStepSchema = z.object({
  type: z.enum(['data.create', 'data.update', 'data.delete', 'email.send', 'notification.send', 'api.call', 'navigate']),
  entityId: identifier.optional(),
  screenId: identifier.optional(),
  integrationId: identifier.optional(),
}).strict()

const workflowSchema = z.object({
  id: identifier,
  name: label,
  trigger: workflowTriggerSchema,
  steps: z.array(workflowStepSchema).max(50),
}).strict()

const integrationSchema = z.object({
  id: identifier,
  provider: identifier,
  capabilities: z.array(identifier).min(1).max(30),
  environment: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'Environment references must be uppercase variable names.')).max(30).default([]),
}).strict()

const projectSpecificationSchema = z.object({
  version: z.literal(1),
  product: z.object({
    name: label,
    description: z.string().trim().min(1).max(2_000),
    kind: z.enum(['website', 'application']),
  }).strict(),
  targets: z.array(targetSchema).min(1).max(4),
  screens: z.array(screenSchema).min(1).max(100),
  data: z.object({ entities: z.array(entitySchema).max(100) }).strict(),
  access: z.object({
    roles: z.array(roleSchema).min(1).max(50),
    permissions: z.array(permissionSchema).max(500),
  }).strict(),
  workflows: z.array(workflowSchema).max(100),
  integrations: z.array(integrationSchema).max(50),
}).strict()

export type TargetPlatform = z.infer<typeof targetPlatform>
export type ProjectSpecification = z.infer<typeof projectSpecificationSchema>

export class ProjectSpecificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectSpecificationError'
  }
}

function assertUniqueIds(items: Array<{ id: string }>, kind: string) {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) throw new ProjectSpecificationError(`Duplicate ${kind} id: ${item.id}.`)
    seen.add(item.id)
  }
}

function validateReferences(specification: ProjectSpecification) {
  const targetPlatforms = new Set<TargetPlatform>()
  for (const target of specification.targets) {
    if (targetPlatforms.has(target.platform)) throw new ProjectSpecificationError(`Duplicate target platform: ${target.platform}.`)
    targetPlatforms.add(target.platform)
    const expectedFramework = target.platform === 'ios' || target.platform === 'android' ? 'expo' : 'nextjs'
    if (target.framework !== expectedFramework) throw new ProjectSpecificationError(`${target.platform} targets must use ${expectedFramework}.`)
  }
  if (!specification.targets.some((target) => target.enabled && target.platform !== 'api')) {
    throw new ProjectSpecificationError('A Lotus project needs at least one user interface target.')
  }

  assertUniqueIds(specification.screens, 'screen')
  assertUniqueIds(specification.data.entities, 'entity')
  assertUniqueIds(specification.access.roles, 'role')
  assertUniqueIds(specification.workflows, 'workflow')
  assertUniqueIds(specification.integrations, 'integration')

  const screenIds = new Set(specification.screens.map(({ id }) => id))
  const entityIds = new Set(specification.data.entities.map(({ id }) => id))
  const roleIds = new Set(specification.access.roles.map(({ id }) => id))
  const integrationIds = new Set(specification.integrations.map(({ id }) => id))

  for (const screen of specification.screens) {
    for (const roleId of screen.access) {
      if (!roleIds.has(roleId)) throw new ProjectSpecificationError(`Screen ${screen.id} references unknown role ${roleId}.`)
    }
  }
  for (const entity of specification.data.entities) {
    assertUniqueIds(entity.fields, `field in ${entity.id}`)
    for (const field of entity.fields) {
      if (field.type === 'relation' && (!field.relationEntityId || !entityIds.has(field.relationEntityId))) {
        throw new ProjectSpecificationError(`Field ${entity.id}.${field.id} must reference a known entity.`)
      }
      if (field.type !== 'relation' && field.relationEntityId) {
        throw new ProjectSpecificationError(`Field ${entity.id}.${field.id} cannot reference an entity unless it is a relation.`)
      }
    }
  }
  for (const permission of specification.access.permissions) {
    if (!roleIds.has(permission.roleId)) throw new ProjectSpecificationError(`Permission references unknown role ${permission.roleId}.`)
    if (permission.resource !== 'project' && !entityIds.has(permission.resource)) {
      throw new ProjectSpecificationError(`Permission references unknown resource ${permission.resource}.`)
    }
  }
  for (const workflow of specification.workflows) {
    if ((workflow.trigger.type === 'form' || workflow.trigger.type === 'button') && !workflow.trigger.screenId) {
      throw new ProjectSpecificationError(`Workflow ${workflow.id} ${workflow.trigger.type} trigger requires a screen.`)
    }
    if (workflow.trigger.screenId && !screenIds.has(workflow.trigger.screenId)) {
      throw new ProjectSpecificationError(`Workflow ${workflow.id} references unknown screen ${workflow.trigger.screenId}.`)
    }
    for (const step of workflow.steps) {
      if (step.type.startsWith('data.') && !step.entityId) {
        throw new ProjectSpecificationError(`Workflow ${workflow.id} ${step.type} step requires an entity.`)
      }
      if (step.type === 'navigate' && !step.screenId) {
        throw new ProjectSpecificationError(`Workflow ${workflow.id} navigate step requires a screen.`)
      }
      if ((step.type === 'email.send' || step.type === 'api.call') && !step.integrationId) {
        throw new ProjectSpecificationError(`Workflow ${workflow.id} ${step.type} step requires an integration.`)
      }
      if (step.screenId && !screenIds.has(step.screenId)) throw new ProjectSpecificationError(`Workflow ${workflow.id} references unknown screen ${step.screenId}.`)
      if (step.entityId && !entityIds.has(step.entityId)) throw new ProjectSpecificationError(`Workflow ${workflow.id} references unknown entity ${step.entityId}.`)
      if (step.integrationId && !integrationIds.has(step.integrationId)) throw new ProjectSpecificationError(`Workflow ${workflow.id} references unknown integration ${step.integrationId}.`)
    }
  }
}

export function parseProjectSpecification(input: unknown): ProjectSpecification {
  const result = projectSpecificationSchema.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new ProjectSpecificationError(issue?.message ?? 'Project specification is invalid.')
  }
  const redacted = projectSpecificationSchema.parse(JSON.parse(redactSensitiveValues(JSON.stringify(result.data))))
  validateReferences(redacted)
  return redacted
}

const frameworks: Record<TargetPlatform, 'nextjs' | 'expo'> = {
  web: 'nextjs',
  ios: 'expo',
  android: 'expo',
  api: 'nextjs',
}

export function createProjectSpecification(input: {
  name: string
  prompt: string
  kind?: 'website' | 'application'
  targets: TargetPlatform[]
}): ProjectSpecification {
  const targets = [...new Set(input.targets)]
  if (!targets.some((target) => target !== 'api')) {
    throw new ProjectSpecificationError('A Lotus project needs at least one user interface target.')
  }

  return parseProjectSpecification({
    version: 1,
    product: {
      name: input.name,
      description: input.prompt,
      kind: input.kind ?? 'application',
    },
    targets: targets.map((platform) => ({ platform, framework: frameworks[platform], enabled: true })),
    screens: [{ id: 'home', name: 'Home', route: '/', kind: 'page', access: [] }],
    data: { entities: [] },
    access: { roles: [{ id: 'owner', name: 'Owner' }], permissions: [] },
    workflows: [],
    integrations: [],
  })
}
