import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  generateText: vi.fn(),
  get: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: 'user-a' } })) } },
}))
vi.mock('@/lib/db', () => ({ db: { insert: mocks.insert, select: mocks.select } }))
vi.mock('@/lib/projects', () => ({ createProjectService: vi.fn(() => ({ get: mocks.get })) }))
vi.mock('ai', () => ({ generateText: mocks.generateText }))
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getWorkspace, runBuild } from '@/app/actions/projects'

describe('inactive project builder guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockResolvedValue({ id: 'project-1', name: 'Archived', status: 'archived' })
  })

  it('hides archived projects from the builder workspace before reading messages', async () => {
    await expect(getWorkspace('project-1')).resolves.toBeNull()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('rejects archived builds before creating a message or invoking generation', async () => {
    await expect(runBuild({ projectId: 'project-1', prompt: 'Change it', model: 'Enigma Auto', currentHtml: '<html></html>' })).rejects.toThrow('not active')
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.generateText).not.toHaveBeenCalled()
  })
})
