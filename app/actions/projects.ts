'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { project, message } from '@/lib/db/schema'
import { and, asc, desc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { generateText } from 'ai'
import { redactSensitiveValues } from '@/lib/safety'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

function id() {
  return crypto.randomUUID()
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
- Load Tailwind via <script src="https://cdn.tailwindcss.com"></script> in the <head> for styling.
- You MAY use vanilla JS for interactivity. Do NOT rely on any framework that needs a bundler.
- Use real, tasteful content and layout. Design mobile-first; it will be shown inside phone/tablet/desktop device frames.
- Use images only from https://images.unsplash.com with real photo URLs, or inline SVG. Never leave broken image placeholders.
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
}

export async function getWorkspace(): Promise<Workspace> {
  const userId = await getUserId()
  const [proj] = await db
    .select()
    .from(project)
    .where(eq(project.userId, userId))
    .orderBy(desc(project.updatedAt))
    .limit(1)

  if (!proj) {
    return { projectId: null, name: 'Untitled', html: null, messages: [] }
  }

  const rows = await db
    .select()
    .from(message)
    .where(and(eq(message.projectId, proj.id), eq(message.userId, userId)))
    .orderBy(asc(message.createdAt))

  const files = (proj.files as Record<string, string>) || {}
  return {
    projectId: proj.id,
    name: redactSensitiveValues(proj.name),
    html: files['index.html'] ? redactSensitiveValues(files['index.html']) : null,
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
  const { prompt, model, currentHtml, context } = input
  const safePrompt = redactSensitiveValues(prompt)
  const safeCurrentHtml = currentHtml ? redactSensitiveValues(currentHtml) : null
  const safeContextBlock = redactSensitiveValues(buildContextBlock(context))

  // Ensure a project exists (scoped to this user).
  let projectId = input.projectId
  if (projectId) {
    const [owned] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.userId, userId)))
      .limit(1)
    if (!owned) projectId = null
  }
  let projectName = deriveName(safePrompt)
  if (!projectId) {
    projectId = id()
    await db.insert(project).values({ id: projectId, userId, name: projectName, mode: 'html', files: {} })
  } else {
    const [existing] = await db
      .select({ name: project.name })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.userId, userId)))
      .limit(1)
    if (existing) projectName = existing.name
  }

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

  let html = currentHtml ?? ''
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

  const reply = currentHtml
    ? 'Done — I applied your change and refreshed the live preview.'
    : 'Here is your app. It is rendering live in the preview — describe any change to refine it.'

  // Persist the generated app + assistant reply.
  await db
    .update(project)
    .set({ files: { 'index.html': html }, updatedAt: new Date() })
    .where(and(eq(project.id, projectId), eq(project.userId, userId)))

  await db.insert(message).values({
    id: id(),
    projectId,
    userId,
    role: 'assistant',
    content: reply,
  })

  return { projectId, name: projectName, html, reply }
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
