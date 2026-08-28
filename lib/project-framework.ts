import { z } from 'zod'

export const projectFrameworkSchema = z.enum(['static', 'react', 'nextjs', 'expo'])
export type ProjectFramework = z.infer<typeof projectFrameworkSchema>

export const createProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(100).default('Untitled project'),
  framework: projectFrameworkSchema.default('static'),
})

export const PROJECT_FRAMEWORKS: Array<{ id: ProjectFramework; label: string; description: string; platforms: string }> = [
  { id: 'static', label: 'Static HTML', description: 'HTML, CSS, and JavaScript with the fastest preview.', platforms: 'Web' },
  { id: 'react', label: 'React', description: 'Component-based web apps with a bundled live preview.', platforms: 'Web' },
  { id: 'nextjs', label: 'Next.js', description: 'Next.js project identity with a React preview adapter.', platforms: 'Web + API' },
  { id: 'expo', label: 'Expo', description: 'React Native project identity for iOS and Android apps.', platforms: 'iOS + Android' },
]

type StarterFile = { path: string; content: string }

const staticFiles: StarterFile[] = [
  { path: 'index.html', content: '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1">\n    <title>Lotus app</title>\n    <link rel="stylesheet" href="styles.css">\n  </head>\n  <body>\n    <main><h1>Start building</h1></main>\n    <script src="script.js"></script>\n  </body>\n</html>\n' },
  { path: 'styles.css', content: ':root { font-family: system-ui, sans-serif; }\nbody { margin: 0; padding: 2rem; }\n' },
  { path: 'script.js', content: 'console.info("Lotus starter ready")\n' },
]

const reactFiles: StarterFile[] = [
  { path: 'index.html', content: '<!doctype html>\n<html lang="en">\n  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Lotus app</title></head>\n  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>\n</html>\n' },
  { path: 'src/main.jsx', content: "import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App.jsx'\nimport './styles.css'\n\ncreateRoot(document.getElementById('root')).render(<App />)\n" },
  { path: 'src/App.jsx', content: "export default function App() {\n  return <main className=\"app\"><h1>Start building</h1></main>\n}\n" },
  { path: 'src/styles.css', content: ':root { font-family: Inter, system-ui, sans-serif; }\n* { box-sizing: border-box; }\nbody { margin: 0; }\n.app { min-height: 100vh; display: grid; place-items: center; padding: 2rem; }\n' },
]

export function frameworkProjectSetup(framework: ProjectFramework) {
  const isComponentProject = framework !== 'static'
  return {
    runtime: isComponentProject ? 'react' as const : 'static' as const,
    framework,
    buildTool: framework === 'static' ? null : framework === 'nextjs' ? 'next' : framework === 'expo' ? 'expo' : 'vite',
    entryPath: 'index.html',
    metadata: isComponentProject ? { generationEntry: 'src/App.jsx', previewAdapter: 'react' } : {},
    files: isComponentProject ? reactFiles : staticFiles,
    targets: framework === 'expo' ? ['ios', 'android'] as const : framework === 'nextjs' ? ['web', 'api'] as const : ['web'] as const,
  }
}
