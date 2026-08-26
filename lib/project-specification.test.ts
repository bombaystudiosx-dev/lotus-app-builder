import { describe, expect, it } from 'vitest'

import {
  ProjectSpecificationError,
  createProjectSpecification,
  parseProjectSpecification,
} from '@/lib/project-specification'

describe('project specification', () => {
  it('creates one shared product model for responsive web and native app targets', () => {
    const specification = createProjectSpecification({
      name: 'Field Service',
      prompt: 'Build a field service app for dispatchers and technicians',
      targets: ['web', 'ios', 'android', 'api'],
    })

    expect(specification).toMatchObject({
      version: 1,
      product: { name: 'Field Service', kind: 'application' },
      targets: [
        { platform: 'web', framework: 'nextjs', enabled: true },
        { platform: 'ios', framework: 'expo', enabled: true },
        { platform: 'android', framework: 'expo', enabled: true },
        { platform: 'api', framework: 'nextjs', enabled: true },
      ],
      data: { entities: [] },
      access: { roles: [{ id: 'owner', name: 'Owner' }] },
      integrations: [],
    })
    expect(specification.screens.map((screen) => screen.id)).toEqual(['home'])
  })

  it('creates a website specification without inventing app-only targets', () => {
    const specification = createProjectSpecification({
      name: 'Lotus Coffee',
      prompt: 'Create a coffee shop website',
      kind: 'website',
      targets: ['web'],
    })

    expect(specification.product.kind).toBe('website')
    expect(specification.targets).toEqual([
      expect.objectContaining({ platform: 'web', framework: 'nextjs' }),
    ])
    expect(specification.targets).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ platform: 'ios' })]),
    )
  })

  it('normalizes duplicate targets and always keeps at least one render target', () => {
    const specification = createProjectSpecification({
      name: 'Inventory',
      prompt: 'Build inventory software',
      targets: ['android', 'android', 'api'],
    })

    expect(specification.targets.map((target) => target.platform)).toEqual(['android', 'api'])
    expect(() => createProjectSpecification({
      name: 'Headless only',
      prompt: 'Build an API',
      targets: ['api'],
    })).toThrow('at least one user interface target')
  })

  it('rejects duplicate targets, API-only products, and platform/framework mismatches at the parse boundary', () => {
    const base = createProjectSpecification({
      name: 'Strict targets',
      prompt: 'Build an app',
      targets: ['web'],
    })

    expect(() => parseProjectSpecification({ ...base, targets: [base.targets[0], base.targets[0]] })).toThrow('Duplicate target')
    expect(() => parseProjectSpecification({ ...base, targets: [{ platform: 'api', framework: 'nextjs', enabled: true }] })).toThrow('at least one user interface target')
    expect(() => parseProjectSpecification({ ...base, targets: [{ platform: 'ios', framework: 'nextjs', enabled: true }] })).toThrow('must use expo')
    expect(() => parseProjectSpecification({ ...base, targets: [{ platform: 'web', framework: 'expo', enabled: true }] })).toThrow('must use nextjs')
  })

  it('rejects unknown keys, unsafe identifiers, duplicate ids, and invalid references', () => {
    const base = createProjectSpecification({
      name: 'Operations',
      prompt: 'Build an operations dashboard',
      targets: ['web'],
    })

    expect(() => parseProjectSpecification({ ...base, secret: 'must-not-pass' })).toThrow('Unrecognized')
    expect(() => parseProjectSpecification({
      ...base,
      screens: [{ ...base.screens[0], id: '../admin' }],
    })).toThrow(ProjectSpecificationError)
    expect(() => parseProjectSpecification({
      ...base,
      access: { ...base.access, roles: [base.access.roles[0], base.access.roles[0]] },
    })).toThrow('Duplicate role id')
    expect(() => parseProjectSpecification({
      ...base,
      workflows: [{
        id: 'submit-job',
        name: 'Submit job',
        trigger: { type: 'form', screenId: 'missing-screen' },
        steps: [],
      }],
    })).toThrow('unknown screen')
  })

  it('does not permit secrets or executable source inside the product specification', () => {
    const base = createProjectSpecification({
      name: 'Safe app',
      prompt: 'Build a safe app',
      targets: ['web'],
    })

    expect(() => parseProjectSpecification({
      ...base,
      integrations: [{
        id: 'payments',
        provider: 'stripe',
        capabilities: ['checkout'],
        secret: 'sk_test_exposed',
      }],
    })).toThrow('Unrecognized')
    expect(() => parseProjectSpecification({
      ...base,
      screens: [{ ...base.screens[0], source: '<script>alert(1)</script>' }],
    })).toThrow('Unrecognized')
    expect(parseProjectSpecification({
      ...base,
      product: { ...base.product, description: 'Connect with API_KEY=supersecretvalue' },
    }).product.description).toBe('Connect with API_KEY=[REDACTED]')
  })

  it('requires semantically complete workflow triggers, steps, and permission resources', () => {
    const base = createProjectSpecification({
      name: 'Workflow safety',
      prompt: 'Build a workflow app',
      targets: ['web'],
    })
    const withEntity = {
      ...base,
      data: { entities: [{ id: 'job', name: 'Job', fields: [] }] },
    }

    expect(() => parseProjectSpecification({
      ...withEntity,
      workflows: [{ id: 'submit', name: 'Submit', trigger: { type: 'form' }, steps: [] }],
    })).toThrow('form trigger requires a screen')
    expect(() => parseProjectSpecification({
      ...withEntity,
      workflows: [{ id: 'save', name: 'Save', trigger: { type: 'button', screenId: 'home' }, steps: [{ type: 'data.create' }] }],
    })).toThrow('data.create step requires an entity')
    expect(() => parseProjectSpecification({
      ...withEntity,
      workflows: [{ id: 'go', name: 'Go', trigger: { type: 'button', screenId: 'home' }, steps: [{ type: 'navigate' }] }],
    })).toThrow('navigate step requires a screen')
    expect(() => parseProjectSpecification({
      ...withEntity,
      access: { ...base.access, permissions: [{ roleId: 'owner', resource: 'missing', actions: ['read'] }] },
    })).toThrow('unknown resource')
  })

  it('accepts relational data, permissions, workflows, and environment references', () => {
    const base = createProjectSpecification({
      name: 'Bookings',
      prompt: 'Build a booking app',
      targets: ['web', 'ios', 'android', 'api'],
    })
    const parsed = parseProjectSpecification({
      ...base,
      screens: [
        base.screens[0],
        { id: 'bookings', name: 'Bookings', route: '/bookings', kind: 'collection', access: ['staff'] },
      ],
      data: {
        entities: [{
          id: 'booking',
          name: 'Booking',
          fields: [
            { id: 'customer-name', name: 'Customer name', type: 'text', required: true },
            { id: 'starts-at', name: 'Starts at', type: 'datetime', required: true },
          ],
        }],
      },
      access: {
        roles: [
          base.access.roles[0],
          { id: 'staff', name: 'Staff' },
        ],
        permissions: [{ roleId: 'staff', resource: 'booking', actions: ['create', 'read', 'update'] }],
      },
      workflows: [{
        id: 'create-booking',
        name: 'Create booking',
        trigger: { type: 'form', screenId: 'bookings' },
        steps: [{ type: 'data.create', entityId: 'booking' }],
      }],
      integrations: [{
        id: 'transactional-email',
        provider: 'resend',
        capabilities: ['send-email'],
        environment: ['RESEND_API_KEY'],
      }],
    })

    expect(parsed.access.permissions[0]).toMatchObject({ roleId: 'staff', resource: 'booking' })
    expect(parsed.workflows[0].steps[0]).toMatchObject({ type: 'data.create', entityId: 'booking' })
    expect(parsed.integrations[0].environment).toEqual(['RESEND_API_KEY'])
  })
})
