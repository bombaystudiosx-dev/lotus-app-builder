import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectImportedFramework, downloadGitHubRepository, listGitHubRepositories } from '@/lib/github-import'

afterEach(() => vi.unstubAllGlobals())

function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status }) }

describe('GitHub project imports', () => {
  it('lists repositories without exposing credentials', async () => {
    const fetch = vi.fn().mockResolvedValue(response([{ full_name: 'lotus/site', name: 'site', owner: { login: 'lotus' }, private: true, default_branch: 'main', description: null, updated_at: '2026-01-01' }]))
    vi.stubGlobal('fetch', fetch)

    await expect(listGitHubRepositories('secret-token')).resolves.toEqual([expect.objectContaining({ fullName: 'lotus/site', private: true, defaultBranch: 'main' })])
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-token')
  })

  it('imports safe text files and skips secrets and binary files', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ truncated: false, tree: [
        { path: 'package.json', type: 'blob', sha: 'one', size: 32 },
        { path: 'src/App.tsx', type: 'blob', sha: 'two', size: 20 },
        { path: '.env.local', type: 'blob', sha: 'secret', size: 20 },
        { path: 'CON.txt', type: 'blob', sha: 'reserved', size: 20 },
        { path: 'public/logo.png', type: 'blob', sha: 'binary', size: 4 },
      ] }))
      .mockResolvedValueOnce(response({ encoding: 'base64', content: Buffer.from('{"dependencies":{"next":"16"}}').toString('base64') }))
      .mockResolvedValueOnce(response({ encoding: 'base64', content: Buffer.from('export default function App(){}').toString('base64') }))
      .mockResolvedValueOnce(response({ encoding: 'base64', content: Buffer.from([0, 1, 2, 3]).toString('base64') }))
    vi.stubGlobal('fetch', fetch)

    const result = await downloadGitHubRepository('token', { repository: 'lotus/site', branch: 'main' })
    expect(result.framework).toBe('nextjs')
    expect(result.files.map(file => file.path)).toEqual(['package.json', 'src/App.tsx'])
    expect(result.skippedFiles).toBe(3)
  })

  it('detects Expo, React, and static repositories', () => {
    expect(detectImportedFramework([{ path: 'package.json', content: '{"dependencies":{"expo":"latest"}}' }])).toBe('expo')
    expect(detectImportedFramework([{ path: 'src/App.jsx', content: '' }])).toBe('react')
    expect(detectImportedFramework([{ path: 'index.html', content: '' }])).toBe('static')
  })
})
