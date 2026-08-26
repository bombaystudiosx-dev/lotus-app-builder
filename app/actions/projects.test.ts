import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  generateText: vi.fn(),
  get: vi.fn(),
  getRuntime: vi.fn(),
  getSpecification: vi.fn(),
  getFileByPath: vi.fn(),
  updateFile: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: 'user-a' } })) } },
}))
vi.mock('@/lib/db', () => ({ db: { insert: mocks.insert, select: mocks.select } }))
vi.mock('@/lib/projects', () => ({ createProjectService: vi.fn(() => ({
  get: mocks.get,
  getRuntime: mocks.getRuntime,
  getSpecification: mocks.getSpecification,
  getFileByPath: mocks.getFileByPath,
  updateFile: mocks.updateFile,
})) }))
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

describe('runtime entry build persistence', () => {
  const entry = { id: 'entry-1', path: 'src/main.html', content: '<main>Renamed entry</main>', encoding: 'utf-8', updatedAt: new Date(100) }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockResolvedValue({ id: 'project-1', name: 'Active', status: 'active' })
    mocks.getRuntime.mockResolvedValue({ entryPath: 'src/main.html' })
    mocks.getSpecification.mockResolvedValue({
      version: 1,
      product: { name: 'Active', description: 'Build dispatch software with API_KEY=supersecretvalue', kind: 'application' },
      targets: [{ platform: 'web', framework: 'nextjs', enabled: true }],
      screens: [{ id: 'home', name: 'Home', route: '/', kind: 'page', access: [] }],
      data: { entities: [] },
      access: { roles: [{ id: 'owner', name: 'Owner' }], permissions: [] },
      workflows: [],
      integrations: [],
    })
    mocks.getFileByPath.mockResolvedValue(entry)
    mocks.insert.mockReturnValue({ values: vi.fn(async () => undefined) })
    mocks.generateText.mockResolvedValue({ text: '<!doctype html><html><body>Built</body></html>' })
    mocks.updateFile.mockResolvedValue({ ...entry, content: '<!doctype html><html><body>Built</body></html>', updatedAt: new Date(200) })
  })

  it('reads and writes the renamed runtime entry with its captured optimistic version', async () => {
    await runBuild({ projectId: 'project-1', prompt: 'Change it', model: 'Enigma Auto', currentHtml: '<main>Stale client</main>' })

    expect(mocks.getFileByPath).toHaveBeenCalledWith('user-a', 'project-1', 'src/main.html')
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('<main>Renamed entry</main>') }))
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('"platform":"web"') }))
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.not.stringContaining('supersecretvalue') }))
    expect(mocks.updateFile).toHaveBeenCalledWith('user-a', 'project-1', 'entry-1', {
      content: '<!doctype html><html><body>Built</body></html>',
      expectedUpdatedAt: entry.updatedAt,
    })
  })

  it('rejects a stale generation after a concurrent editor save without a second write or assistant reply', async () => {
    mocks.updateFile.mockRejectedValue(new Error('This file changed elsewhere.'))

    await expect(runBuild({ projectId: 'project-1', prompt: 'Change it', model: 'Enigma Auto', currentHtml: '<main>Stale client</main>' })).rejects.toThrow('changed elsewhere')

    expect(mocks.updateFile).toHaveBeenCalledTimes(1)
    expect(mocks.insert).toHaveBeenCalledTimes(1)
  })
})
