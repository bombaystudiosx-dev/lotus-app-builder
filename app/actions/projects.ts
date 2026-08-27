'use server'

import { db, sqlite } from '@/lib/db'
import { message } from '@/lib/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { generateText } from 'ai'
import { redactSensitiveValues } from '@/lib/safety'
import { createProjectService } from '@/lib/projects'
import { createPostgresProjectService } from '@/lib/postgres-projects'
import { postgresPool, rows } from '@/lib/db/postgres'
import { assembleStaticPreview, type PreviewBuild } from '@/lib/preview-runtime'
import type { ProjectSpecification } from '@/lib/project-specification'
import { ensureGuestWorkspace } from '@/lib/guest-workspace'
import { cookies } from 'next/headers'
import { AI_PROVIDER_COOKIE, aiProviderSchema, aiProviderStatus, decryptAiProviderConfig, defaultAiProviderConfig, encryptAiProviderConfig, generationModel, type AiProviderStatus } from '@/lib/ai-provider'

async function getUserId() {
  if (usePostgres) {
    await postgresPool.query(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)
      ON CONFLICT (id) DO NOTHING`, ['lotus-public-guest', 'Lotus Guest', 'guest@lotus.local'])
    return 'lotus-public-guest'
  }
  return ensureGuestWorkspace(sqlite)
}

function id() {
  return crypto.randomUUID()
}

const usePostgres = Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== 'test'
const projects = usePostgres
  ? createPostgresProjectService(postgresPool)
  : createProjectService(db)

async function listProjectMessages(projectId: string, userId: string) {
  if (usePostgres) return rows<{ id: string; role: string; content: string; createdAt: Date }>(postgresPool,
    'SELECT id, role, content, "createdAt" FROM message WHERE "projectId" = $1 AND "userId" = $2 ORDER BY "createdAt"', [projectId, userId])
  return db.select().from(message).where(and(eq(message.projectId, projectId), eq(message.userId, userId))).orderBy(asc(message.createdAt))
}

async function appendProjectMessage(input: { id: string; projectId: string; userId: string; role: 'user' | 'assistant'; content: string }) {
  if (usePostgres) {
    await postgresPool.query('INSERT INTO message (id, "projectId", "userId", role, content) VALUES ($1, $2, $3, $4, $5)', [input.id, input.projectId, input.userId, input.role, input.content])
    return
  }
  await db.insert(message).values(input)
}
const activePreviewBuilds = new Map<string, { revision: number; controller: AbortController }>()

function fileDto(file: Awaited<ReturnType<typeof projects.getFile>> extends infer Result ? NonNullable<Result> : never) {
  return { id: file.id, path: file.path, content: file.content, encoding: file.encoding as 'utf-8' | 'utf-16le', version: file.updatedAt.getTime() }
}

function refreshProjectViews(projectId?: string) {
  revalidatePath('/')
  if (projectId) revalidatePath(`/projects/${projectId}`)
}

export async function getProjectDashboard() {
  const userId = await getUserId()
  const [items, settings] = await Promise.all([projects.listDashboard(userId), projects.getSettings(userId)])
  return { projects: items, settings }
}

export async function getUserSettings() {
  return projects.getSettings(await getUserId())
}

export async function getAiProviderStatusAction(): Promise<AiProviderStatus> {
  return aiProviderStatus(decryptAiProviderConfig((await cookies()).get(AI_PROVIDER_COOKIE)?.value))
}

export async function saveAiProviderAction(input: unknown): Promise<{ ok: true; status: AiProviderStatus } | { ok: false; error: string }> {
  try {
    const existing = decryptAiProviderConfig((await cookies()).get(AI_PROVIDER_COOKIE)?.value)
    const candidate = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    const config = aiProviderSchema.parse({
      ...candidate,
      apiKey: candidate.apiKey || (candidate.provider === existing.provider ? existing.apiKey : ''),
    })
    ;(await cookies()).set(AI_PROVIDER_COOKIE, encryptAiProviderConfig(config), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
    return { ok: true, status: aiProviderStatus(config) }
  } catch (error) {
    const issue = error instanceof Error ? error.message : ''
    const message = issue.match(/"message":\s*"([^"]+)"/)?.[1]
    return { ok: false, error: message ?? (issue.includes('encryption') ? issue : 'Check the provider settings and try again.') }
  }
}

export async function clearAiProviderAction(): Promise<AiProviderStatus> {
  ;(await cookies()).delete(AI_PROVIDER_COOKIE)
  return aiProviderStatus(defaultAiProviderConfig())
}

export async function createBlankProjectAction(name?: string) {
  const created = await projects.createBlank(await getUserId(), name)
  refreshProjectViews(created.id)
  return created
}

const STARTER_TEMPLATES = {
  'saas-starter': { name: 'SaaS Starter', eyebrow: 'Workspace', title: 'Build your next product', body: 'A focused SaaS foundation with navigation, metrics, and a clear upgrade path.', accent: '#f29a70' },
  'commerce-store': { name: 'Commerce Store', eyebrow: 'New collection', title: 'Everyday objects, refined', body: 'A responsive storefront foundation with a merchandising grid and conversion-ready calls to action.', accent: '#b87850' },
  'ai-assistant': { name: 'AI Assistant', eyebrow: 'Intelligent workspace', title: 'Ask, create, refine', body: 'A calm AI product shell with prompts, recent work, and a production-ready responsive layout.', accent: '#d79368' },
  'analytics-dashboard': { name: 'Analytics Dashboard', eyebrow: 'This week', title: 'Performance at a glance', body: 'A clean analytics foundation for product metrics, activity, and operational reporting.', accent: '#c6865e' },
} as const

export async function createTemplateProjectAction(templateId: string) {
  const template = STARTER_TEMPLATES[templateId as keyof typeof STARTER_TEMPLATES]
  if (!template) throw new Error('Template not found.')
  const userId = await getUserId()
  const created = await projects.createBlank(userId, template.name)
  const runtime = await projects.getRuntime(userId, created.id)
  const entry = runtime ? await projects.getFileByPath(userId, created.id, runtime.entryPath) : null
  if (!entry) throw new Error('Template project entry file is unavailable.')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${template.name}</title><style>*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui;background:#fffaf7;color:#261c17}nav{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(24px,7vw,96px);border-bottom:1px solid #eee1d9}.brand{font-family:Georgia,serif;font-size:24px;color:#9f612a}.button{display:inline-flex;padding:12px 18px;border-radius:12px;background:${template.accent};color:white;text-decoration:none;font-weight:700}.hero{min-height:calc(100vh - 72px);display:grid;place-items:center;padding:64px 24px;background:radial-gradient(circle at 70% 20%,#ffe3d2,transparent 35%),#fffaf7}.content{max-width:760px;text-align:center}.eyebrow{color:${template.accent};font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{font-size:clamp(42px,8vw,82px);line-height:.98;margin:20px 0;letter-spacing:-.055em}p{max-width:620px;margin:0 auto 30px;color:#735f54;font-size:clamp(17px,2vw,21px);line-height:1.6}</style></head><body><nav><span class="brand">${template.name}</span><a class="button" href="#start">Get started</a></nav><main class="hero"><div class="content"><div class="eyebrow">${template.eyebrow}</div><h1>${template.title}</h1><p>${template.body}</p><a id="start" class="button" href="#">Start building</a></div></main></body></html>`
  await projects.updateFile(userId, created.id, entry.id, { content: html, expectedUpdatedAt: entry.updatedAt })
  refreshProjectViews(created.id)
  return created
}

export async function renameProjectAction(projectId: string, name: string) {
  const updated = await projects.rename(await getUserId(), projectId, name)
  refreshProjectViews(projectId)
  return updated
}

export async function duplicateProjectAction(projectId: string) {
  const duplicate = await projects.duplicate(await getUserId(), projectId)
  refreshProjectViews(duplicate.id)
  return duplicate
}

export async function archiveProjectAction(projectId: string) {
  const updated = await projects.archive(await getUserId(), projectId)
  refreshProjectViews(projectId)
  return updated
}

export async function restoreProjectAction(projectId: string) {
  const updated = await projects.restore(await getUserId(), projectId)
  refreshProjectViews(projectId)
  return updated
}

export async function softDeleteProjectAction(projectId: string) {
  const updated = await projects.softDelete(await getUserId(), projectId)
  refreshProjectViews(projectId)
  return updated
}

export async function permanentlyDeleteProjectAction(projectId: string) {
  await projects.permanentlyDelete(await getUserId(), projectId)
  refreshProjectViews(projectId)
}

export async function updateSettingsAction(input: unknown) {
  const updated = await projects.updateSettings(await getUserId(), input)
  refreshProjectViews()
  return updated
}

export async function createProjectFileAction(projectId: string, path: string, content = '') {
  const created = await projects.createFile(await getUserId(), projectId, { path, content })
  refreshProjectViews(projectId)
  return fileDto(created)
}

export async function renameProjectFileAction(projectId: string, fileId: string, path: string) {
  const userId = await getUserId()
  const updated = await projects.renameFile(userId, projectId, fileId, path)
  const runtime = await projects.getRuntime(userId, projectId)
  refreshProjectViews(projectId)
  return { file: fileDto(updated), entryPath: runtime?.entryPath ?? 'index.html' }
}

export async function updateProjectFileAction(projectId: string, fileId: string, content: string, expectedVersion?: number) {
  const updated = await projects.updateFile(await getUserId(), projectId, fileId, { content, expectedUpdatedAt: expectedVersion === undefined ? undefined : new Date(expectedVersion) })
  refreshProjectViews(projectId)
  return fileDto(updated)
}

export async function trashProjectFileAction(projectId: string, fileId: string) {
  const trashed = await projects.trashFile(await getUserId(), projectId, fileId)
  refreshProjectViews(projectId)
  return fileDto(trashed)
}

export async function restoreProjectFileAction(projectId: string, fileId: string) {
  const restored = await projects.restoreFile(await getUserId(), projectId, fileId)
  refreshProjectViews(projectId)
  return fileDto(restored)
}

// Friendly model labels from the Lotus UI -> AI Gateway model ids.
const MODEL_MAP: Record<string, string> = {
  'Enigma Auto': 'anthropic/claude-sonnet-4.5',
  'GPT-4.1': 'openai/gpt-4.1',
  'Claude Sonnet': 'anthropic/claude-sonnet-4.5',
  'Claude Opus': 'anthropic/claude-opus-4.5',
  'Gemini Pro': 'google/gemini-2.5-pro',
  'DeepSeek Coder': 'anthropic/claude-sonnet-4.5',
}

function resolveModel(label: string) {
  return MODEL_MAP[label] ?? 'anthropic/claude-sonnet-4.5'
}

const SYSTEM_PROMPT = `You are Lotus, an expert AI app builder. You generate a SINGLE, complete, self-contained HTML document that renders a polished, production-quality app screen.

Hard rules:
- Output ONLY the raw HTML document. Start with <!DOCTYPE html>. No markdown fences, no commentary before or after.
- The document MUST be fully self-contained and runnable in an iframe with no build step.
- Use a complete inline <style> block. Do not load Tailwind, fonts, images, scripts, or other resources from a CDN or remote URL.
- You MAY use vanilla JS for interactivity. Do NOT rely on any framework that needs a bundler.
- Use real, tasteful content and layout. Design mobile-first; it will be shown inside phone/tablet/desktop device frames.
- Use inline SVG or data URLs for images. Never leave broken image placeholders.
- Make it beautiful, cohesive, and immediately usable. Prefer a clear visual hierarchy, good spacing, and a small, consistent color palette.

When the user asks for a change, return the FULL updated HTML document reflecting the current state plus their requested change.`

export interface WorkspaceMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: string
}

export interface Workspace {
  projectId: string | null
  name: string
  html: string | null
  messages: WorkspaceMessage[]
  files: Array<{ id: string; path: string; content: string; encoding: 'utf-8' | 'utf-16le'; version: number }>
  entryPath: string
  runtime: 'static' | 'react'
  specification: ProjectSpecification
}

export async function getWorkspace(projectId: string): Promise<Workspace | null> {
  const userId = await getUserId()
  const proj = await projects.get(userId, projectId)
  if (!proj || proj.status !== 'active') return null

  const messageRows = await listProjectMessages(proj.id, userId)

  const [runtime, files, specification] = await Promise.all([
    projects.getRuntime(userId, proj.id),
    projects.listFiles(userId, proj.id),
    projects.getSpecification(userId, proj.id),
  ])
  const entryPath = runtime?.entryPath ?? 'index.html'
  const index = files.find((file) => file.path === entryPath)
  return {
    projectId: proj.id,
    name: redactSensitiveValues(proj.name),
    html: index ? redactSensitiveValues(index.content) : null,
    files: files.map(fileDto),
    entryPath,
    runtime: runtime?.runtime ?? 'static',
    specification,
    messages: messageRows.map((r) => ({
      id: r.id,
      role: r.role as 'user' | 'assistant',
      content: redactSensitiveValues(r.content),
      ts: r.createdAt.toISOString(),
    })),
  }
}

export interface BuildContext {
  connectors?: string[]
  skills?: string[]
  agents?: string[]
  capabilities?: string[]
  attachments?: string[]
}

export interface RunBuildInput {
  projectId: string | null
  prompt: string
  model: string
  currentHtml: string | null
  context?: BuildContext
}

function buildContextBlock(ctx?: BuildContext): string {
  if (!ctx) return ''
  const parts: string[] = []
  if (ctx.connectors?.length) parts.push(`Connected services: ${ctx.connectors.join(', ')}.`)
  if (ctx.capabilities?.length) parts.push(`Enabled capabilities: ${ctx.capabilities.join(', ')}.`)
  if (ctx.skills?.length) parts.push(`Active skills: ${ctx.skills.join(', ')}.`)
  if (ctx.agents?.length) parts.push(`Active agents: ${ctx.agents.join(', ')}.`)
  if (ctx.attachments?.length) parts.push(`User attached files: ${ctx.attachments.join(', ')}.`)
  if (!parts.length) return ''
  return `\n\nBuild context (reflect these in the app where relevant):\n- ${parts.join('\n- ')}`
}

export interface RunBuildResult {
  projectId: string
  name: string
  html: string
  reply: string
  version: number
}

export type RunBuildActionResult =
  | { ok: true; data: RunBuildResult }
  | { ok: false; error: string }

// Derive a short, human title for a project from the first prompt.
function deriveName(prompt: string): string {
  const cleaned = prompt.replace(/^(build|make|create|generate|design)\s+(?:me\s+)?(?:(?:an|a|the)\s+)?/i, '').trim()
  const words = cleaned.split(/\s+/).slice(0, 5).join(' ')
  const base = (words || prompt).slice(0, 48)
  return base.charAt(0).toUpperCase() + base.slice(1)
}

export async function runBuild(input: RunBuildInput): Promise<RunBuildResult> {
  const userId = await getUserId()
  const { prompt, model, context } = input
  const safePrompt = redactSensitiveValues(prompt)
  const safeContextBlock = redactSensitiveValues(buildContextBlock(context))

  // Ensure a project exists (scoped to this user).
  let projectId = input.projectId
  const existingProject = projectId ? await projects.get(userId, projectId) : null
  if (projectId && !existingProject) throw new Error('Project not found.')
  if (existingProject && existingProject.status !== 'active') throw new Error('Project is not active.')
  let projectName = deriveName(safePrompt)
  if (!projectId) {
    const created = await projects.createBlank(userId, projectName)
    projectId = created.id
    projectName = created.name
  } else if (existingProject) {
    projectName = existingProject.name
  }

  // Capture the configured entry and its optimistic version before generation.
  // The model call can be long-running, so the final write must fail if an
  // editor save changes this exact file while generation is in flight.
  const runtime = await projects.getRuntime(userId, projectId)
  if (!runtime) throw new Error('Project runtime is unavailable.')
  const entry = await projects.getFileByPath(userId, projectId, runtime.entryPath)
  if (!entry) throw new Error('Project entry file is unavailable.')
  const expectedUpdatedAt = entry.updatedAt
  const safeCurrentHtml = input.currentHtml ? redactSensitiveValues(entry.content) : null
  const specification = await projects.getSpecification(userId, projectId)
  const safeSpecification = redactSensitiveValues(JSON.stringify(specification))
  const specificationBlock = `\n\nLotus project specification (treat this as the product contract; render the current web preview from it):\n${safeSpecification}`

  // Persist the user's message immediately.
  await appendProjectMessage({
    id: id(),
    projectId,
    userId,
    role: 'user',
    content: safePrompt,
  })

  // Build the prompt for the model, giving it the current app as context.
  const userContent = safeCurrentHtml
    ? `Here is the current app HTML:\n\n${safeCurrentHtml}\n\n---\n\nApply this change and return the full updated HTML document:\n${safePrompt}${safeContextBlock}${specificationBlock}`
    : `Build this app and return a complete HTML document:\n${safePrompt}${safeContextBlock}${specificationBlock}`

  let html = entry.content
  try {
    const providerConfig = decryptAiProviderConfig((await cookies()).get(AI_PROVIDER_COOKIE)?.value)
    const { text } = await generateText({
      model: generationModel(providerConfig, resolveModel(model)),
      system: SYSTEM_PROMPT,
      prompt: userContent,
      maxOutputTokens: 8000,
    })
    html = redactSensitiveValues(stripFences(text))
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    // Surface common provider setup failures clearly instead of a generic error.
    if (/credit card|customer_verification_required|valid credit/i.test(raw)) {
      throw new Error(
        'AI generation is not enabled yet: the Vercel AI Gateway requires a credit card on file to unlock your free credits. Add one in your Vercel dashboard under AI, then try again.',
      )
    }
    if (/401|403|unauthorized|invalid.*(?:api|key)|authentication/i.test(raw)) throw new Error('The selected AI provider rejected its API key. Update it in Settings and try again.')
    throw new Error('Generation failed. Check your server-side AI provider configuration and try again.')
  }

  const reply = input.currentHtml
    ? 'Done — I applied your change and refreshed the live preview.'
    : 'Here is your app. It is rendering live in the preview — describe any change to refine it.'

  // Persist the generated app + assistant reply.
  const updatedEntry = await projects.updateFile(userId, projectId, entry.id, { content: html, expectedUpdatedAt })

  await appendProjectMessage({
    id: id(),
    projectId,
    userId,
    role: 'assistant',
    content: reply,
  })

  return { projectId, name: projectName, html, reply, version: updatedEntry.updatedAt.getTime() }
}

export async function runBuildAction(input: RunBuildInput): Promise<RunBuildActionResult> {
  try {
    return { ok: true, data: await runBuild(input) }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (input.projectId && message === 'Project not found.') {
      try {
        return { ok: true, data: await runBuild({ ...input, projectId: null }) }
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : ''
        return { ok: false, error: publicBuildError(retryMessage) }
      }
    }
    return { ok: false, error: publicBuildError(message) }
  }
}

function publicBuildError(message: string) {
  if (/credit card|AI generation is not enabled/i.test(message)) return message
  if (/changed elsewhere/i.test(message)) return 'This project changed while Lotus was building. Please try your request again.'
  if (/Generation failed/i.test(message)) return message
  if (/rejected its API key/i.test(message)) return message
  if (/not active/i.test(message)) return 'This project is not active. Restore it before building.'
  return 'Lotus could not complete this build. Please try again.'
}

export async function buildProjectPreviewAction(projectId: string, revision = 0, sessionId = 'default'): Promise<PreviewBuild> {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Preview revision is invalid.')
  if (!/^[a-z\d-]{1,64}$/i.test(sessionId)) throw new Error('Preview session is invalid.')
  const userId = await getUserId()
  const project = await projects.get(userId, projectId)
  if (!project || project.status !== 'active') throw new Error('Project not found.')
  const [runtime, files] = await Promise.all([projects.getRuntime(userId, projectId), projects.listFiles(userId, projectId)])
  if (!runtime) throw new Error('Project runtime is unavailable.')
  const input = files.map((file) => ({ path: file.path, content: file.content }))
  if (runtime.runtime === 'react') {
    const { bundleReactProject } = await import('@/lib/local-bundler')
    const key = `${userId}:${projectId}:${sessionId}`
    const previous = activePreviewBuilds.get(key)
    if (previous && previous.revision > revision) throw new Error('Local build superseded by a newer revision.')
    previous?.controller.abort()
    const controller = new AbortController()
    const active = { revision, controller }
    activePreviewBuilds.set(key, active)
    try {
      const result = await bundleReactProject(input, runtime.entryPath, { ownerKey: userId, signal: controller.signal })
      return { ...result, revision }
    } finally {
      if (activePreviewBuilds.get(key) === active) activePreviewBuilds.delete(key)
    }
  }
  return { ...assembleStaticPreview(input, runtime.entryPath), revision }
}

function stripFences(text: string): string {
  let out = text.trim()
  // Remove ```html ... ``` or ``` ... ``` wrappers if the model added them.
  const fence = /^```(?:html)?\s*([\s\S]*?)\s*```$/i
  const m = out.match(fence)
  if (m) out = m[1].trim()
  // If there's leading prose before the doctype, cut to the doctype/html.
  const idx = out.search(/<!DOCTYPE html>|<html[\s>]/i)
  if (idx > 0) out = out.slice(idx)
  return out
}
