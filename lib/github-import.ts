import { z } from 'zod'
import type { ProjectFramework } from '@/lib/project-framework'

const MAX_IMPORT_FILES = 250
const MAX_FILE_BYTES = 1_048_576
const MAX_IMPORT_BYTES = 4_718_592
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const repositorySchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/)
const branchSchema = z.string().trim().min(1).max(255).refine(value => !value.includes('\0'))

export const githubImportInputSchema = z.object({
  repository: repositorySchema,
  branch: branchSchema,
})

export interface GitHubRepository {
  fullName: string
  name: string
  owner: string
  private: boolean
  defaultBranch: string
  description: string
  updatedAt: string
}

export interface GitHubBranch { name: string; protected: boolean }
export interface GitHubImportFile { path: string; content: string }
export interface GitHubImportSnapshot {
  repository: string
  branch: string
  framework: ProjectFramework
  files: GitHubImportFile[]
  skippedFiles: number
}

const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Lotus-App-Builder',
})

async function githubJson(url: string, token: string) {
  const response = await fetch(url, { headers: githubHeaders(token), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('GitHub access expired. Reconnect GitHub in Settings.')
    if (response.status === 404) throw new Error('GitHub repository or branch was not found.')
    throw new Error('GitHub could not complete the request.')
  }
  const text = await response.text()
  if (text.length > 8_000_000) throw new Error('GitHub returned too much data for this import.')
  try { return JSON.parse(text) as unknown } catch { throw new Error('GitHub returned an invalid response.') }
}

export async function listGitHubRepositories(token: string): Promise<GitHubRepository[]> {
  const payload = await githubJson('https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&per_page=100', token)
  return z.array(z.object({
    full_name: repositorySchema,
    name: z.string(),
    owner: z.object({ login: z.string() }),
    private: z.boolean(),
    default_branch: branchSchema,
    description: z.string().nullable(),
    updated_at: z.string(),
  })).parse(payload).map(repo => ({
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner.login,
    private: repo.private,
    defaultBranch: repo.default_branch,
    description: repo.description ?? '',
    updatedAt: repo.updated_at,
  }))
}

export async function listGitHubBranches(token: string, repository: string): Promise<GitHubBranch[]> {
  const safeRepository = repositorySchema.parse(repository)
  const payload = await githubJson(`https://api.github.com/repos/${safeRepository}/branches?per_page=100`, token)
  return z.array(z.object({ name: branchSchema, protected: z.boolean().default(false) })).parse(payload)
}

function isSafeImportPath(path: string) {
  if (!path || path.length > 240 || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false
  const parts = path.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || WINDOWS_RESERVED.test(part) || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part))) return false
  if (parts.some(part => ['.git', 'node_modules'].includes(part.toLowerCase()))) return false
  const base = parts.at(-1)!.toLowerCase()
  return !(
    base === '.env' || base.startsWith('.env.') || base === 'credentials.json' ||
    /(?:service[-_]?account.*\.json|\.(?:pem|key|p12|pfx|keystore|jks))$/.test(base)
  )
}

function decodeBlob(content: string) {
  const bytes = Buffer.from(content.replace(/\s/g, ''), 'base64')
  if (bytes.includes(0)) return null
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return null }
}

export function detectImportedFramework(files: GitHubImportFile[]): ProjectFramework {
  const packageFile = files.find(file => file.path === 'package.json')
  if (packageFile) {
    try {
      const pkg = JSON.parse(packageFile.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies }
      if (dependencies.next) return 'nextjs'
      if (dependencies.expo || dependencies['react-native']) return 'expo'
      if (dependencies.react) return 'react'
    } catch { /* Keep detecting from file structure. */ }
  }
  if (files.some(file => /(?:^|\/)next\.config\.[cm]?[jt]s$/.test(file.path))) return 'nextjs'
  if (files.some(file => file.path === 'app.json' || file.path === 'app.config.js' || file.path === 'app.config.ts')) return 'expo'
  if (files.some(file => /\.(?:jsx|tsx)$/.test(file.path))) return 'react'
  return 'static'
}

export async function downloadGitHubRepository(token: string, input: unknown): Promise<GitHubImportSnapshot> {
  const { repository, branch } = githubImportInputSchema.parse(input)
  const treePayload = await githubJson(`https://api.github.com/repos/${repository}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token)
  const tree = z.object({
    truncated: z.boolean().default(false),
    tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string(), size: z.number().int().nonnegative().optional() })),
  }).parse(treePayload)
  if (tree.truncated) throw new Error('This repository is too large for a complete GitHub import.')

  let selectedBytes = 0
  let skippedFiles = 0
  const candidates: Array<{ path: string; sha: string }> = []
  for (const item of tree.tree) {
    if (item.type !== 'blob') continue
    const size = item.size ?? MAX_FILE_BYTES + 1
    if (!isSafeImportPath(item.path) || size > MAX_FILE_BYTES || candidates.length >= MAX_IMPORT_FILES || selectedBytes + size > MAX_IMPORT_BYTES) {
      skippedFiles += 1
      continue
    }
    selectedBytes += size
    candidates.push({ path: item.path, sha: item.sha })
  }

  const files: GitHubImportFile[] = []
  for (let index = 0; index < candidates.length; index += 8) {
    const batch = candidates.slice(index, index + 8)
    const loaded = await Promise.all(batch.map(async candidate => {
      const payload = await githubJson(`https://api.github.com/repos/${repository}/git/blobs/${candidate.sha}`, token)
      const blob = z.object({ encoding: z.literal('base64'), content: z.string() }).parse(payload)
      const content = decodeBlob(blob.content)
      return content === null ? null : { path: candidate.path, content }
    }))
    for (const file of loaded) {
      if (file) files.push(file)
      else skippedFiles += 1
    }
  }
  if (!files.length) throw new Error('No supported text files were found in this repository.')
  return { repository, branch, framework: detectImportedFramework(files), files, skippedFiles }
}
