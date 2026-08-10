'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { message } from '@/lib/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { generateText } from 'ai'
import { redactSensitiveValues } from '@/lib/safety'
import { createProjectService } from '@/lib/projects'
import { assembleStaticPreview, type PreviewBuild } from '@/lib/preview-runtime'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

function id() {
  return crypto.randomUUID()
}

const projects = createProjectService(db)
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

export async function createBlankProjectAction(name?: string) {
  const created = await projects.createBlank(await getUserId(), name)
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
}

export async function getWorkspace(projectId: string): Promise<Workspace | null> {
  const userId = await getUserId()
  const proj = await projects.get(userId, projectId)
  if (!proj || proj.status !== 'active') return null

  const rows = await db
    .select()
    .from(message)
    .where(and(eq(message.projectId, proj.id), eq(message.userId, userId)))
    .orderBy(asc(message.createdAt))

  const [runtime, files] = await Promise.all([
    projects.getRuntime(userId, proj.id),
    projects.listFiles(userId, proj.id),
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
    messages: rows.map((r) => ({
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

// Derive a short, human title for a project from the first prompt.
function deriveName(prompt: string): string {
  const cleaned = prompt.replace(/^(build|make|create|generate|design)\s+(me\s+)?(a|an|the)?\s*/i, '').trim()
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
  if (existingProject?.status !== 'active') throw new Error('Project is not active.')
  let projectName = deriveName(safePrompt)
  if (!projectId) {
    const created = await projects.createBlank(userId, projectName)
    projectId = created.id
    projectName = created.name
  } else {
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

  // Persist the user's message immediately.
  await db.insert(message).values({
    id: id(),
    projectId,
    userId,
    role: 'user',
    content: safePrompt,
  })

  // Build the prompt for the model, giving it the current app as context.
  const userContent = safeCurrentHtml
    ? `Here is the current app HTML:\n\n${safeCurrentHtml}\n\n---\n\nApply this change and return the full updated HTML document:\n${safePrompt}${safeContextBlock}`
    : `Build this app and return a complete HTML document:\n${safePrompt}${safeContextBlock}`

  let html = entry.content
  try {
    const { text } = await generateText({
      model: resolveModel(model),
      system: SYSTEM_PROMPT,
      prompt: userContent,
      maxOutputTokens: 8000,
    })
    html = redactSensitiveValues(stripFences(text))
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    // Surface the AI Gateway's billing prerequisite clearly instead of a generic error.
    if (/credit card|customer_verification_required|valid credit/i.test(raw)) {
      throw new Error(
        'AI generation is not enabled yet: the Vercel AI Gateway requires a credit card on file to unlock your free credits. Add one in your Vercel dashboard under AI, then try again.',
      )
    }
    throw new Error('Generation failed. Check your server-side AI provider configuration and try again.')
  }

  const reply = input.currentHtml
    ? 'Done — I applied your change and refreshed the live preview.'
    : 'Here is your app. It is rendering live in the preview — describe any change to refine it.'

  // Persist the generated app + assistant reply.
  const updatedEntry = await projects.updateFile(userId, projectId, entry.id, { content: html, expectedUpdatedAt })

  await db.insert(message).values({
    id: id(),
    projectId,
    userId,
    role: 'assistant',
    content: reply,
  })

  return { projectId, name: projectName, html, reply, version: updatedEntry.updatedAt.getTime() }
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
