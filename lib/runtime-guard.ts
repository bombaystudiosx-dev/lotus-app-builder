import { parse } from 'acorn'

type AstNode = { type: string; start: number; end: number; body?: AstNode; [key: string]: unknown }

const GUARD_MARKER = '/* lotus-runtime-guard */'

function guardSource(guardName: string, stateName: string, nowName: string, queueName: string) {
  return `${GUARD_MARKER}
var ${stateName}={count:0,scheduled:false,start:0};
var ${nowName}=performance.now.bind(performance),${queueName}=queueMicrotask.bind(globalThis);
function ${guardName}(){var state=${stateName};if(!state.scheduled){state.scheduled=true;state.start=${nowName}();${queueName}(function(){state.count=0;state.scheduled=false})}state.count++;if(state.count%1024===0&&${nowName}()-state.start>100){throw new Error('Lotus preview execution budget exceeded')}};
`
}

function randomGuardSuffix() {
  const values = new Uint32Array(2)
  globalThis.crypto.getRandomValues(values)
  return `${values[0].toString(36)}${values[1].toString(36)}`
}

export function hasStaticallyUnboundedLoop(source: string) {
  return /\bwhile\s*\(\s*(?:true|1)\s*\)|\bfor\s*\(\s*;\s*;\s*\)/.test(source)
}

export function hasBlockedBrowserCapability(source: string) {
  return /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|SharedWorker|Worker)\b|\bnavigator\s*\.\s*sendBeacon\b|\bwindow\s*\.\s*open\b|\b(?:window\s*\.\s*)?location\s*(?:=|\.\s*(?:assign|replace)\s*\()|\bdocument\s*\.\s*location\b/.test(source)
}

function walk(value: unknown, visit: (node: AstNode) => void) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  const node = value as AstNode
  if (typeof node.type === 'string' && typeof node.start === 'number') visit(node)
  for (const [key, child] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc') continue
    walk(child, visit)
  }
}

export function instrumentJavaScript(source: string) {
  const suffix = randomGuardSuffix()
  const guardName = `__lotusGuard_${suffix}`
  const stateName = `__lotusState_${suffix}`
  const nowName = `__lotusNow_${suffix}`
  const queueName = `__lotusQueue_${suffix}`
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) as unknown as AstNode
  const insertions: Array<{ position: number; text: string }> = []
  walk(ast, (node) => {
    const isLoop = ['WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement'].includes(node.type)
    const isFunction = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    if (!isLoop && !isFunction) return
    const body = node.body
    if (!body) return
    if (body.type === 'BlockStatement') {
      insertions.push({ position: body.start + 1, text: `${guardName}();` })
      return
    }
    if (isLoop) {
      insertions.push({ position: body.start, text: `{${guardName}();` }, { position: body.end, text: '}' })
      return
    }
    if (node.type === 'ArrowFunctionExpression') {
      insertions.push({ position: body.start, text: `(${guardName}(),` }, { position: body.end, text: ')' })
    }
  })
  if (!insertions.length) return source
  let output = source
  for (const insertion of insertions.sort((left, right) => right.position - left.position)) {
    output = `${output.slice(0, insertion.position)}${insertion.text}${output.slice(insertion.position)}`
  }
  return `${guardSource(guardName, stateName, nowName, queueName)}${output}`
}
