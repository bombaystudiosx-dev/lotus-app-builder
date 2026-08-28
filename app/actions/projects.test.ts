import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  revalidatePath: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  bundleReactProject: vi.fn(),
  generateText: vi.fn(),
  listDashboard: vi.fn(),
  getSettings: vi.fn(),
  get: vi.fn(),
  createBlank: vi.fn(),
  rename: vi.fn(),
  duplicate: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  softDelete: vi.fn(),
  permanentlyDelete: vi.fn(),
  updateSettings: vi.fn(),
  getRuntime: vi.fn(),
  getSpecification: vi.fn(),
  listFiles: vi.fn(),
  getFile: vi.fn(),
  getFileByPath: vi.fn(),
  createFile: vi.fn(),
  renameFile: vi.fn(),
  updateFile: vi.fn(),
  trashFile: vi.fn(),
  restoreFile: vi.fn(),
  guestUser: vi.fn(),
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mocks.session } },
}))
vi.mock('@/lib/db', () => ({ db: { insert: mocks.insert, select: mocks.select }, sqlite: {} }))
vi.mock('@/lib/guest-workspace', () => ({ ensureGuestWorkspace: mocks.guestUser }))
vi.mock('@/lib/projects', () => ({ createProjectService: vi.fn(() => ({
  listDashboard: mocks.listDashboard,
  getSettings: mocks.getSettings,
  get: mocks.get,
  createBlank: mocks.createBlank,
  rename: mocks.rename,
  duplicate: mocks.duplicate,
  archive: mocks.archive,
  restore: mocks.restore,
  softDelete: mocks.softDelete,
  permanentlyDelete: mocks.permanentlyDelete,
  updateSettings: mocks.updateSettings,
  getRuntime: mocks.getRuntime,
  getSpecification: mocks.getSpecification,
  listFiles: mocks.listFiles,
  getFile: mocks.getFile,
  getFileByPath: mocks.getFileByPath,
  createFile: mocks.createFile,
  renameFile: mocks.renameFile,
  updateFile: mocks.updateFile,
  trashFile: mocks.trashFile,
  restoreFile: mocks.restoreFile,
})) }))
vi.mock('ai', () => ({ generateText: mocks.generateText }))
vi.mock('@/lib/local-bundler', () => ({ bundleReactProject: mocks.bundleReactProject }))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: mocks.cookieGet, set: mocks.cookieSet, delete: mocks.cookieDelete })),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import {
  archiveProjectAction,
  buildProjectPreviewAction,
  createBlankProjectAction,
  createTemplateProjectAction,
  createProjectFileAction,
  duplicateProjectAction,
  getProjectDashboard,
  getAiProviderStatusAction,
  getUserSettings,
  getWorkspace,
  permanentlyDeleteProjectAction,
  renameProjectAction,
  renameProjectFileAction,
  restoreProjectAction,
  restoreProjectFileAction,
  runBuild,
  runBuildAction,
  saveAiProviderAction,
  softDeleteProjectAction,
  trashProjectFileAction,
  updateProjectFileAction,
  updateSettingsAction,
} from '@/app/actions/projects'

const specification = {
  version: 1 as const,
  product: { name: 'Active', description: 'Build dispatch software with API_KEY=supersecretvalue', kind: 'application' as const },
  targets: [{ platform: 'web' as const, framework: 'nextjs' as const, enabled: true }],
  screens: [{ id: 'home', name: 'Home', route: '/', kind: 'page' as const, access: [] }],
  data: { entities: [] },
  access: { roles: [{ id: 'owner', name: 'Owner' }], permissions: [] },
  workflows: [],
  integrations: [],
}

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = 'test-secret-with-at-least-sixteen-characters'
  mocks.session.mockResolvedValue({ user: { id: 'user-a' } })
  mocks.guestUser.mockReturnValue('user-a')
  mocks.cookieGet.mockReturnValue(undefined)
})

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
    mocks.getSpecification.mockResolvedValue(specification)
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

  it('generates into the component entry for React-compatible frameworks', async () => {
    const component = { ...entry, id: 'component-1', path: 'src/App.jsx', content: 'export default function App(){ return <main>Old</main> }' }
    mocks.getRuntime.mockResolvedValue({ runtime: 'react', framework: 'nextjs', entryPath: 'index.html', metadata: { generationEntry: 'src/App.jsx', previewAdapter: 'react' } })
    mocks.getFileByPath.mockResolvedValue(component)
    mocks.generateText.mockResolvedValue({ text: '```jsx\nexport default function App(){ return <main>New</main> }\n```' })
    mocks.updateFile.mockResolvedValue({ ...component, updatedAt: new Date(300) })

    const result = await runBuild({ projectId: 'project-1', prompt: 'Update it', model: 'Enigma Auto', currentHtml: '<html>ignored</html>' })
    expect(mocks.getFileByPath).toHaveBeenCalledWith('user-a', 'project-1', 'src/App.jsx')
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('project framework is nextjs') }))
    expect(mocks.updateFile).toHaveBeenCalledWith('user-a', 'project-1', 'component-1', expect.objectContaining({ content: 'export default function App(){ return <main>New</main> }' }))
    expect(result.entryPath).toBe('src/App.jsx')
  })
})

describe('authenticated project and file actions', () => {
  const file = { id: 'file-1', path: 'index.html', content: '<main>Safe</main>', encoding: 'utf-8', updatedAt: new Date(500) }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'user-a' } })
    mocks.listDashboard.mockResolvedValue([{ id: 'project-1' }])
    mocks.getSettings.mockResolvedValue({ theme: 'dark' })
    mocks.createBlank.mockResolvedValue({ id: 'created-1' })
    mocks.rename.mockResolvedValue({ id: 'project-1', name: 'Renamed' })
    mocks.duplicate.mockResolvedValue({ id: 'copy-1' })
    mocks.archive.mockResolvedValue({ id: 'project-1', status: 'archived' })
    mocks.restore.mockResolvedValue({ id: 'project-1', status: 'active' })
    mocks.softDelete.mockResolvedValue({ id: 'project-1', status: 'trashed' })
    mocks.updateSettings.mockResolvedValue({ theme: 'light' })
    mocks.createFile.mockResolvedValue(file)
    mocks.renameFile.mockResolvedValue({ ...file, path: 'src/index.html' })
    mocks.updateFile.mockResolvedValue({ ...file, content: 'updated' })
    mocks.trashFile.mockResolvedValue(file)
    mocks.restoreFile.mockResolvedValue(file)
    mocks.getRuntime.mockResolvedValue({ entryPath: 'src/index.html' })
  })

  it('scopes dashboard, lifecycle, settings, and file mutations to the session owner', async () => {
    await expect(getProjectDashboard()).resolves.toEqual({ projects: [{ id: 'project-1' }], settings: { theme: 'dark' } })
    await expect(getUserSettings()).resolves.toEqual({ theme: 'dark' })
    await expect(createBlankProjectAction()).resolves.toEqual({ id: 'created-1' })
    await expect(renameProjectAction('project-1', 'Renamed')).resolves.toMatchObject({ name: 'Renamed' })
    await expect(duplicateProjectAction('project-1')).resolves.toEqual({ id: 'copy-1' })
    await expect(archiveProjectAction('project-1')).resolves.toMatchObject({ status: 'archived' })
    await expect(restoreProjectAction('project-1')).resolves.toMatchObject({ status: 'active' })
    await expect(softDeleteProjectAction('project-1')).resolves.toMatchObject({ status: 'trashed' })
    await expect(permanentlyDeleteProjectAction('project-1')).resolves.toBeUndefined()
    await expect(updateSettingsAction({ theme: 'light' })).resolves.toEqual({ theme: 'light' })
    await expect(createProjectFileAction('project-1', 'index.html')).resolves.toMatchObject({ id: 'file-1', version: 500 })
    await expect(renameProjectFileAction('project-1', 'file-1', 'src/index.html')).resolves.toMatchObject({ entryPath: 'src/index.html' })
    await expect(updateProjectFileAction('project-1', 'file-1', 'updated', 100)).resolves.toMatchObject({ content: 'updated' })
    await expect(updateProjectFileAction('project-1', 'file-1', 'updated')).resolves.toMatchObject({ content: 'updated' })
    await expect(trashProjectFileAction('project-1', 'file-1')).resolves.toMatchObject({ id: 'file-1' })
    await expect(restoreProjectFileAction('project-1', 'file-1')).resolves.toMatchObject({ id: 'file-1' })

    expect(mocks.createBlank).toHaveBeenCalledWith('user-a', 'Untitled project', 'static')
    expect(mocks.createFile).toHaveBeenCalledWith('user-a', 'project-1', { path: 'index.html', content: '' })
    expect(mocks.updateFile).toHaveBeenCalledWith('user-a', 'project-1', 'file-1', { content: 'updated', expectedUpdatedAt: new Date(100) })
    expect(mocks.updateFile).toHaveBeenCalledWith('user-a', 'project-1', 'file-1', { content: 'updated', expectedUpdatedAt: undefined })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/projects/project-1')
  })

  it('persists a validated framework choice when creating a project', async () => {
    mocks.createBlank.mockResolvedValue({ id: 'react-project' })
    await expect(createBlankProjectAction({ name: 'Customer portal', framework: 'react' })).resolves.toEqual({ id: 'react-project' })
    expect(mocks.createBlank).toHaveBeenCalledWith('user-a', 'Customer portal', 'react')
    await expect(createBlankProjectAction({ name: 'Bad', framework: 'wordpress' })).rejects.toThrow()
  })

  it('falls back to index.html when a renamed project has no runtime record', async () => {
    mocks.getRuntime.mockResolvedValue(null)

    await expect(renameProjectFileAction('project-1', 'file-1', 'src/index.html')).resolves.toMatchObject({ entryPath: 'index.html' })
  })

  it('creates a real persisted project from an approved starter template', async () => {
    const templateEntry = { ...file, id: 'template-entry', updatedAt: new Date(700) }
    mocks.createBlank.mockResolvedValue({ id: 'template-project', name: 'SaaS Starter' })
    mocks.getRuntime.mockResolvedValue({ entryPath: 'index.html' })
    mocks.getFileByPath.mockResolvedValue(templateEntry)

    await expect(createTemplateProjectAction('saas-starter')).resolves.toMatchObject({ id: 'template-project' })
    expect(mocks.createBlank).toHaveBeenCalledWith('user-a', 'SaaS Starter')
    expect(mocks.updateFile).toHaveBeenCalledWith('user-a', 'template-project', 'template-entry', expect.objectContaining({
      content: expect.stringContaining('Build your next product'),
      expectedUpdatedAt: templateEntry.updatedAt,
    }))
    await expect(createTemplateProjectAction('not-real')).rejects.toThrow('Template not found')
  })

  it('uses the public guest workspace when the session is missing', async () => {
    mocks.session.mockResolvedValue(null)
    mocks.getSettings.mockResolvedValue({ theme: 'system' })

    await expect(getUserSettings()).resolves.toEqual({ theme: 'system' })
    expect(mocks.getSettings).toHaveBeenCalledWith('user-a')
  })
})

describe('active workspace assembly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'user-a' } })
    mocks.get.mockResolvedValue({ id: 'project-1', name: 'API_KEY=secretvalue', status: 'active' })
    mocks.getRuntime.mockResolvedValue(null)
    mocks.getSpecification.mockResolvedValue(specification)
    mocks.listFiles.mockResolvedValue([])
    mocks.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => [{ id: 'm1', role: 'user', content: 'API_KEY=secretvalue', createdAt: new Date(10) }]),
        })),
      })),
    })
  })

  it('returns a redacted static workspace with safe defaults when the entry is absent', async () => {
    await expect(getWorkspace('project-1')).resolves.toMatchObject({
      projectId: 'project-1',
      name: 'API_KEY=[REDACTED]',
      html: null,
      files: [],
      entryPath: 'index.html',
      runtime: 'static',
      messages: [{ id: 'm1', content: 'API_KEY=[REDACTED]', ts: new Date(10).toISOString() }],
    })
  })

  it('returns the configured React entry and redacts generated file content at the HTML boundary', async () => {
    const file = { id: 'entry', path: 'src/main.tsx', content: '<main>API_KEY=secretvalue</main>', encoding: 'utf-8', updatedAt: new Date(50) }
    mocks.getRuntime.mockResolvedValue({ runtime: 'react', entryPath: 'src/main.tsx' })
    mocks.listFiles.mockResolvedValue([file])

    const workspace = await getWorkspace('project-1')

    expect(workspace).toMatchObject({ runtime: 'react', entryPath: 'src/main.tsx', html: '<main>API_KEY=[REDACTED]</main>' })
    expect(workspace?.files[0]).toMatchObject({ path: 'src/main.tsx', version: 50 })
  })
})

describe('generation errors and initial builds', () => {
  const entry = { id: 'entry-1', path: 'index.html', content: '<main>Starter</main>', encoding: 'utf-8', updatedAt: new Date(100) }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'user-a' } })
    mocks.get.mockResolvedValue(null)
    mocks.createBlank.mockResolvedValue({ id: 'created-1', name: 'Inventory tracker' })
    mocks.getRuntime.mockResolvedValue({ runtime: 'static', entryPath: 'index.html' })
    mocks.getFileByPath.mockResolvedValue(entry)
    mocks.getSpecification.mockResolvedValue(specification)
    mocks.insert.mockReturnValue({ values: vi.fn(async () => undefined) })
    mocks.updateFile.mockResolvedValue({ ...entry, updatedAt: new Date(200) })
    mocks.generateText.mockResolvedValue({ text: 'Intro\n<!DOCTYPE html><html><body>Built API_KEY=secretvalue</body></html>' })
  })

  it('creates a named project, includes all context, strips prose, redacts output, and uses the fallback model', async () => {
    const result = await runBuild({
      projectId: null,
      prompt: 'Build me an inventory tracker API_KEY=secretvalue',
      model: 'Unknown model',
      currentHtml: null,
      context: { connectors: ['Stripe'], capabilities: ['payments'], skills: ['design'], agents: ['tester'], attachments: ['brief.pdf'] },
    })

    expect(mocks.createBlank).toHaveBeenCalledWith('user-a', 'Inventory tracker API_KEY=[REDACTED]')
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: 'anthropic/claude-sonnet-4.5',
      prompt: expect.stringContaining('Connected services: Stripe'),
    }))
    expect(result).toMatchObject({ projectId: 'created-1', name: 'Inventory tracker', reply: expect.stringContaining('Here is your app') })
    expect(result.html).toContain('<!DOCTYPE html>')
    expect(result.html).not.toContain('secretvalue')
    expect(mocks.insert).toHaveBeenCalledTimes(2)
  })

  it('rejects missing projects, runtimes, and entry files before generation', async () => {
    await expect(runBuild({ projectId: 'missing', prompt: 'Build', model: 'GPT-4.1', currentHtml: null })).rejects.toThrow('Project not found')
    mocks.get.mockResolvedValue({ id: 'project-1', name: 'Active', status: 'active' })
    mocks.getRuntime.mockResolvedValue(null)
    await expect(runBuild({ projectId: 'project-1', prompt: 'Build', model: 'GPT-4.1', currentHtml: null })).rejects.toThrow('runtime')
    mocks.getRuntime.mockResolvedValue({ runtime: 'static', entryPath: 'index.html' })
    mocks.getFileByPath.mockResolvedValue(null)
    await expect(runBuild({ projectId: 'project-1', prompt: 'Build', model: 'GPT-4.1', currentHtml: null })).rejects.toThrow('entry file')
  })

  it('reports AI billing requirements distinctly from generic provider failures', async () => {
    mocks.get.mockResolvedValue({ id: 'project-1', name: 'Active', status: 'active' })
    mocks.generateText.mockRejectedValueOnce(new Error('customer_verification_required: add credit card'))
    await expect(runBuild({ projectId: 'project-1', prompt: 'Build', model: 'GPT-4.1', currentHtml: null })).rejects.toThrow('credit card')
    mocks.generateText.mockRejectedValueOnce('offline')
    await expect(runBuild({ projectId: 'project-1', prompt: 'Build', model: 'GPT-4.1', currentHtml: null })).rejects.toThrow('Generation failed')
  })

  it('recovers a project lost between Vercel instances without returning a React server error', async () => {
    const result = await runBuildAction({ projectId: 'missing', prompt: 'Build a website generator', model: 'Enigma Auto', currentHtml: null })

    expect(result).toMatchObject({ ok: true, data: { projectId: 'created-1' } })
    expect(mocks.createBlank).toHaveBeenCalled()
  })

  it('returns a safe serializable build error instead of throwing through React Server Components', async () => {
    mocks.get.mockResolvedValue({ id: 'project-1', name: 'Active', status: 'active' })
    mocks.generateText.mockRejectedValue(new Error('provider secret details'))

    await expect(runBuildAction({ projectId: 'project-1', prompt: 'Build', model: 'GPT-4.1', currentHtml: null })).resolves.toEqual({
      ok: false,
      error: 'Generation failed. Check your server-side AI provider configuration and try again.',
    })
  })
})

describe('bring-your-own AI provider settings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores a provider key only in an encrypted HttpOnly cookie and returns a masked status', async () => {
    const result = await saveAiProviderAction({ provider: 'openai', apiKey: 'sk-provider-secret', model: 'gpt-4.1', baseURL: '' })

    expect(result).toMatchObject({ ok: true, status: { provider: 'openai', configured: true, keyHint: '••••cret' } })
    expect(mocks.cookieSet).toHaveBeenCalledWith('lotus-ai-provider', expect.not.stringContaining('sk-provider-secret'), expect.objectContaining({ httpOnly: true, sameSite: 'lax' }))
  })

  it('reports the default Vercel provider when no provider cookie exists', async () => {
    await expect(getAiProviderStatusAction()).resolves.toMatchObject({ provider: 'vercel', configured: true })
  })

  it('rejects an unsafe custom provider URL before saving credentials', async () => {
    await expect(saveAiProviderAction({ provider: 'custom', apiKey: 'custom-secret-key', model: 'model', baseURL: 'https://127.0.0.1/v1' })).resolves.toEqual({ ok: false, error: 'Enter a public HTTPS API base URL.' })
    expect(mocks.cookieSet).not.toHaveBeenCalled()
  })
})

describe('preview action validation and assembly', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ user: { id: 'user-a' } })
    mocks.get.mockResolvedValue({ id: 'project-1', status: 'active' })
    mocks.getRuntime.mockResolvedValue({ runtime: 'static', entryPath: 'index.html' })
    mocks.listFiles.mockResolvedValue([{ path: 'index.html', content: '<main>Preview</main>' }])
  })

  it('rejects invalid revisions, sessions, projects, and missing runtimes', async () => {
    await expect(buildProjectPreviewAction('project-1', -1)).rejects.toThrow('revision')
    await expect(buildProjectPreviewAction('project-1', 1.5)).rejects.toThrow('revision')
    await expect(buildProjectPreviewAction('project-1', 0, 'bad session!')).rejects.toThrow('session')
    mocks.get.mockResolvedValue(null)
    await expect(buildProjectPreviewAction('project-1')).rejects.toThrow('Project not found')
    mocks.get.mockResolvedValue({ id: 'project-1', status: 'active' })
    mocks.getRuntime.mockResolvedValue(null)
    await expect(buildProjectPreviewAction('project-1')).rejects.toThrow('runtime')
  })

  it('assembles an inert static preview with the requested revision', async () => {
    const result = await buildProjectPreviewAction('project-1', 7, 'safe-session')

    expect(result.revision).toBe(7)
    expect(result.html).toContain('<main>Preview</main>')
  })

  it('bundles a React target through the bounded local builder', async () => {
    mocks.getRuntime.mockResolvedValue({ runtime: 'react', entryPath: 'src/main.tsx' })
    mocks.listFiles.mockResolvedValue([{ path: 'src/main.tsx', content: 'export default null' }])
    mocks.bundleReactProject.mockResolvedValue({ html: '<main>React bundle</main>', diagnostics: [] })

    await expect(buildProjectPreviewAction('project-1', 2, 'react-session')).resolves.toEqual({ html: '<main>React bundle</main>', diagnostics: [], revision: 2 })
    expect(mocks.bundleReactProject).toHaveBeenCalledWith(
      [{ path: 'src/main.tsx', content: 'export default null' }],
      'src/main.tsx',
      expect.objectContaining({ ownerKey: 'user-a', signal: expect.any(AbortSignal) }),
    )
  })
})
