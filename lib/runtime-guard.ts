import { parse } from 'acorn'

type AstNode = { type: string; start: number; end: number; body?: AstNode; [key: string]: unknown }
type ReflectionKind = 'apply' | 'get' | 'getOwnPropertyDescriptor' | 'getOwnPropertyDescriptors' | 'getPrototypeOf' | 'lookupGetter'
type ReflectionCall = { kind: ReflectionKind; args: AstNode[] | null; receiver?: AstNode }

const GUARD_MARKER = '/* lotus-runtime-guard */'
const MAX_ALIAS_PASSES = 64

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

function constantString(node: AstNode | undefined): string | null {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && Array.isArray(node.expressions) && node.expressions.length === 0 && Array.isArray(node.quasis)) {
    return node.quasis.map((part) => (part as AstNode).value && typeof (part as AstNode).value === 'object' ? String(((part as AstNode).value as { cooked?: string }).cooked ?? '') : '').join('')
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = constantString(node.left as AstNode); const right = constantString(node.right as AstNode)
    return left === null || right === null ? null : left + right
  }
  return null
}

function memberName(node: AstNode | undefined) {
  if (!node || node.type !== 'MemberExpression') return null
  return node.computed ? constantString(node.property as AstNode) : (node.property as AstNode | undefined)?.name as string | undefined ?? null
}

function identifierName(node: AstNode | undefined) {
  return node?.type === 'Identifier' ? node.name as string : null
}

function isGlobalObject(node: AstNode | undefined, aliases: Set<string>): boolean {
  const identifier = identifierName(node)
  if (identifier && (['window', 'globalThis', 'self'].includes(identifier) || aliases.has(identifier))) return true
  if (node?.type !== 'MemberExpression') return false
  const property = memberName(node)
  return property === 'defaultView' && identifierName(node.object as AstNode) === 'document' || property === 'window' && isGlobalObject(node.object as AstNode, aliases)
}

function isBuiltin(node: AstNode | undefined, name: string, aliases: Set<string>) {
  const identifier = identifierName(node)
  return identifier === name || Boolean(identifier && aliases.has(identifier))
}

function isObjectPrototype(node: AstNode | undefined, objectAliases: Set<string>) {
  return node?.type === 'MemberExpression'
    && memberName(node) === 'prototype'
    && isBuiltin(node.object as AstNode, 'Object', objectAliases)
}

function isReflectionNamespace(node: AstNode | undefined, reflectAliases: Set<string>, objectAliases: Set<string>) {
  return isBuiltin(node, 'Reflect', reflectAliases) || isBuiltin(node, 'Object', objectAliases) || isObjectPrototype(node, objectAliases)
}

function reflectionKind(
  node: AstNode | undefined,
  reflectAliases: Set<string>,
  objectAliases: Set<string>,
  functionAliases: Map<string, ReflectionKind>,
): ReflectionKind | null {
  if (node?.type === 'CallExpression') {
    const callee = node.callee as AstNode | undefined
    if (callee?.type === 'MemberExpression' && memberName(callee) === 'bind') {
      return reflectionKind(callee.object as AstNode, reflectAliases, objectAliases, functionAliases)
    }
  }
  const identifier = identifierName(node)
  if (identifier && functionAliases.has(identifier)) return functionAliases.get(identifier) ?? null
  if (node?.type !== 'MemberExpression') return null
  const property = memberName(node)
  const owner = node.object as AstNode | undefined
  if (isBuiltin(owner, 'Reflect', reflectAliases) && (property === 'apply' || property === 'get')) return property
  if (isBuiltin(owner, 'Object', objectAliases) && ['getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'getPrototypeOf'].includes(property ?? '')) return property as ReflectionKind
  if (property === '__lookupGetter__' || property === '__lookupSetter__') return 'lookupGetter'
  return null
}

function reflectionCall(
  node: AstNode | undefined,
  reflectAliases: Set<string>,
  objectAliases: Set<string>,
  functionAliases: Map<string, ReflectionKind>,
): ReflectionCall | null {
  if (node?.type !== 'CallExpression') return null
  const callee = node.callee as AstNode | undefined
  const rawArgs = node.arguments as AstNode[] | undefined ?? []
  if (callee?.type === 'MemberExpression' && ['call', 'apply'].includes(memberName(callee) ?? '')) {
    const kind = reflectionKind(callee.object as AstNode, reflectAliases, objectAliases, functionAliases)
    if (!kind) return null
    if (memberName(callee) === 'call') return { kind, receiver: rawArgs[0], args: rawArgs.slice(1) }
    const supplied = rawArgs[1]
    return {
      kind,
      receiver: rawArgs[0],
      args: supplied?.type === 'ArrayExpression' ? ((supplied.elements as AstNode[] | undefined) ?? []).filter(Boolean) : null,
    }
  }
  const kind = reflectionKind(callee, reflectAliases, objectAliases, functionAliases)
  if (!kind) return null
  return { kind, receiver: callee?.type === 'MemberExpression' ? callee.object as AstNode : undefined, args: rawArgs }
}

function isNavigationContainer(
  node: AstNode | undefined,
  globalAliases: Set<string>,
  navigationAliases: Set<string>,
  reflectAliases: Set<string>,
  objectAliases: Set<string>,
  functionAliases: Map<string, ReflectionKind>,
): boolean {
  const identifier = identifierName(node)
  if (identifier === 'document' || identifier && navigationAliases.has(identifier) || isGlobalObject(node, globalAliases)) return true
  if (node?.type === 'MemberExpression') {
    const owner = identifierName(node.object as AstNode)
    if (memberName(node) === 'prototype' && (owner === 'Window' || owner === 'Document')) return true
    if (memberName(node) === '__proto__') {
      return isNavigationContainer(node.object as AstNode, globalAliases, navigationAliases, reflectAliases, objectAliases, functionAliases)
    }
  }
  const reflected = reflectionCall(node, reflectAliases, objectAliases, functionAliases)
  return reflected?.kind === 'getPrototypeOf'
    && Boolean(reflected.args?.[0])
    && isNavigationContainer(reflected.args?.[0], globalAliases, navigationAliases, reflectAliases, objectAliases, functionAliases)
}

function isLocationReference(
  node: AstNode | undefined,
  globalAliases: Set<string>,
  navigationAliases: Set<string>,
  locationAliases: Set<string>,
  reflectAliases: Set<string>,
  objectAliases: Set<string>,
  functionAliases: Map<string, ReflectionKind>,
): boolean {
  if (!node) return false
  const identifier = identifierName(node)
  if (identifier === 'location' || identifier && locationAliases.has(identifier)) return true
  if (node.type === 'MemberExpression') {
    return memberName(node) === 'location'
      && isNavigationContainer(node.object as AstNode, globalAliases, navigationAliases, reflectAliases, objectAliases, functionAliases)
  }
  const reflected = reflectionCall(node, reflectAliases, objectAliases, functionAliases)
  return reflected?.kind === 'get'
    && constantString(reflected.args?.[1]) === 'location'
    && isNavigationContainer(reflected.args?.[0], globalAliases, navigationAliases, reflectAliases, objectAliases, functionAliases)
}

function isBlockedReflectionCall(
  node: AstNode,
  globalAliases: Set<string>,
  navigationAliases: Set<string>,
  reflectAliases: Set<string>,
  objectAliases: Set<string>,
  functionAliases: Map<string, ReflectionKind>,
) {
  const reflected = reflectionCall(node, reflectAliases, objectAliases, functionAliases)
  if (!reflected || reflected.kind === 'getPrototypeOf') return false
  if (reflected.kind === 'apply') {
    return reflected.args === null || reflectionKind(reflected.args?.[0], reflectAliases, objectAliases, functionAliases) !== null
  }
  const blockedName = (candidate: AstNode | undefined) => ['location', 'navigation'].includes(constantString(candidate) ?? '')
  const unknownName = (candidate: AstNode | undefined) => constantString(candidate) === null
  const target = reflected.args?.[0]
  if (reflected.kind === 'getOwnPropertyDescriptors') {
    return !reflected.args || isNavigationContainer(target, globalAliases, navigationAliases, reflectAliases, objectAliases, functionAliases)
  }
  if (reflected.kind === 'lookupGetter') {
    const key = reflected.args?.[0]
    return blockedName(key)
      || Boolean(reflected.receiver && isNavigationContainer(reflected.receiver, globalAliases, navigationAliases, reflectAliases, objectAliases, functionAliases) && unknownName(key))
      || reflected.args === null
  }
  const key = reflected.args?.[1]
  return blockedName(key)
    || Boolean(isNavigationContainer(target, globalAliases, navigationAliases, reflectAliases, objectAliases, functionAliases) && unknownName(key))
    || reflected.args === null
}

function patternBindingName(node: AstNode | undefined) {
  if (node?.type === 'AssignmentPattern') return identifierName(node.left as AstNode)
  return identifierName(node)
}

function destructuredReflectionKind(
  value: AstNode,
  key: string | null,
  reflectAliases: Set<string>,
  objectAliases: Set<string>,
): ReflectionKind | null {
  if (isBuiltin(value, 'Reflect', reflectAliases) && (key === 'apply' || key === 'get')) return key
  if (isBuiltin(value, 'Object', objectAliases) && ['getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'getPrototypeOf'].includes(key ?? '')) return key as ReflectionKind
  if (isObjectPrototype(value, objectAliases) && (key === '__lookupGetter__' || key === '__lookupSetter__')) return 'lookupGetter'
  return null
}

function objectPatternRequestsBlockedCapability(
  target: AstNode | undefined,
  value: AstNode | undefined,
  globalAliases: Set<string>,
  navigationAliases: Set<string>,
  locationAliases: Set<string>,
  reflectAliases: Set<string>,
  objectAliases: Set<string>,
  functionAliases: Map<string, ReflectionKind>,
) {
  if (target?.type !== 'ObjectPattern' || !value) return false
  const properties = target.properties as AstNode[] | undefined
  if (!properties) return false
  const keys = properties.map((property) => constantString(property.key as AstNode) ?? identifierName(property.key as AstNode))
  if (isNavigationContainer(value, globalAliases, navigationAliases, reflectAliases, objectAliases, functionAliases)) return keys.some((key) => key === 'location' || key === 'navigation')
  if (isLocationReference(value, globalAliases, navigationAliases, locationAliases, reflectAliases, objectAliases, functionAliases)) return keys.some((key) => ['href', 'assign', 'replace', 'reload'].includes(key ?? ''))
  return false
}

function isDynamicConstructorReference(node: AstNode | undefined) {
  if (!node) return false
  if (node.type === 'MemberExpression' && memberName(node) === 'constructor') return true
  if (node.type !== 'CallExpression') return false
  const callee = node.callee as AstNode | undefined
  const args = node.arguments as AstNode[] | undefined
  return callee?.type === 'MemberExpression'
    && identifierName(callee.object as AstNode) === 'Reflect'
    && memberName(callee) === 'get'
    && constantString(args?.[1]) === 'constructor'
}

export function hasBlockedBrowserCapability(source: string) {
  let ast: AstNode
  try { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) as unknown as AstNode } catch { return false }
  const globalAliases = new Set<string>()
  const navigationAliases = new Set<string>()
  const locationAliases = new Set<string>()
  const reflectAliases = new Set<string>()
  const objectAliases = new Set<string>()
  const reflectionFunctionAliases = new Map<string, ReflectionKind>()
  let blockedBinding = false
  let aliasesChanged = true
  let aliasPasses = 0
  while (aliasesChanged && aliasPasses < MAX_ALIAS_PASSES) {
    aliasPasses += 1
    aliasesChanged = false
    walk(ast, (node) => {
      if (node.type !== 'VariableDeclarator' && node.type !== 'AssignmentExpression') return
      const target = (node.id ?? node.left) as AstNode | undefined
      const value = (node.init ?? node.right) as AstNode | undefined
      if (!value) return
      if (objectPatternRequestsBlockedCapability(target, value, globalAliases, navigationAliases, locationAliases, reflectAliases, objectAliases, reflectionFunctionAliases)) blockedBinding = true
      if (target?.type === 'ObjectPattern') {
        for (const property of target.properties as AstNode[] | undefined ?? []) {
          const key = constantString(property.key as AstNode) ?? identifierName(property.key as AstNode)
          const name = patternBindingName(property.value as AstNode)
          const kind = destructuredReflectionKind(value, key, reflectAliases, objectAliases)
          if (name && kind) {
            blockedBinding = true
            if (reflectionFunctionAliases.get(name) !== kind) { reflectionFunctionAliases.set(name, kind); aliasesChanged = true }
          }
        }
      }
      const name = identifierName(target)
      if (!name) return
      if (!reflectAliases.has(name) && isBuiltin(value, 'Reflect', reflectAliases)) { reflectAliases.add(name); aliasesChanged = true }
      if (!objectAliases.has(name) && isBuiltin(value, 'Object', objectAliases)) { objectAliases.add(name); aliasesChanged = true }
      const kind = reflectionKind(value, reflectAliases, objectAliases, reflectionFunctionAliases)
      if (kind && reflectionFunctionAliases.get(name) !== kind) { reflectionFunctionAliases.set(name, kind); aliasesChanged = true }
      if (!globalAliases.has(name) && isGlobalObject(value, globalAliases)) { globalAliases.add(name); aliasesChanged = true }
      if (!navigationAliases.has(name) && isNavigationContainer(value, globalAliases, navigationAliases, reflectAliases, objectAliases, reflectionFunctionAliases)) { navigationAliases.add(name); aliasesChanged = true }
      if (!locationAliases.has(name) && isLocationReference(value, globalAliases, navigationAliases, locationAliases, reflectAliases, objectAliases, reflectionFunctionAliases)) { locationAliases.add(name); aliasesChanged = true }
    })
  }
  if (aliasesChanged) return true
  if (blockedBinding) return true
  let blocked = false
  walk(ast, (node) => {
    if (blocked) return
    if (node.type === 'ImportExpression') { blocked = true; return }
    if (node.type === 'MemberExpression') {
      const owner = node.object as AstNode | undefined
      const property = memberName(node)
      if (node.computed && property === null && isReflectionNamespace(owner, reflectAliases, objectAliases)) { blocked = true; return }
      if (reflectionKind(node, reflectAliases, objectAliases, reflectionFunctionAliases)) { blocked = true; return }
      if (node.computed && isNavigationContainer(owner, globalAliases, navigationAliases, reflectAliases, objectAliases, reflectionFunctionAliases) && property === null) { blocked = true; return }
      if (isNavigationContainer(owner, globalAliases, navigationAliases, reflectAliases, objectAliases, reflectionFunctionAliases) && property === 'navigation') { blocked = true; return }
      if (isLocationReference(node, globalAliases, navigationAliases, locationAliases, reflectAliases, objectAliases, reflectionFunctionAliases)) { blocked = true; return }
      if (isLocationReference(owner, globalAliases, navigationAliases, locationAliases, reflectAliases, objectAliases, reflectionFunctionAliases) && ['href', 'assign', 'replace', 'reload'].includes(property ?? '')) { blocked = true; return }
    }
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const target = (node.left ?? node.argument) as AstNode | undefined
      if (isLocationReference(target, globalAliases, navigationAliases, locationAliases, reflectAliases, objectAliases, reflectionFunctionAliases) || target?.type === 'MemberExpression' && isLocationReference(target.object as AstNode, globalAliases, navigationAliases, locationAliases, reflectAliases, objectAliases, reflectionFunctionAliases) && ['href', 'assign', 'replace', 'reload'].includes(memberName(target) ?? '')) { blocked = true; return }
      if (target?.type === 'MemberExpression' && ['innerHTML', 'outerHTML'].includes(memberName(target) ?? '')) { blocked = true; return }
    }
    if (node.type !== 'CallExpression' && node.type !== 'NewExpression') return
    if (node.type === 'CallExpression' && isBlockedReflectionCall(node, globalAliases, navigationAliases, reflectAliases, objectAliases, reflectionFunctionAliases)) { blocked = true; return }
    const callee = node.callee as AstNode | undefined
    const direct = identifierName(callee)
    const property = memberName(callee)
    const owner = callee?.type === 'MemberExpression' ? callee.object as AstNode : undefined
    if (['eval', 'Function', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker'].includes(direct ?? '')) { blocked = true; return }
    if (isDynamicConstructorReference(callee)) { blocked = true; return }
    if (isGlobalObject(owner, globalAliases) && ['eval', 'Function', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'open'].includes(property ?? '')) { blocked = true; return }
    if (isLocationReference(owner, globalAliases, navigationAliases, locationAliases, reflectAliases, objectAliases, reflectionFunctionAliases) && ['assign', 'replace', 'reload'].includes(property ?? '')) { blocked = true; return }
    const argumentsList = node.arguments as AstNode[] | undefined
    if (argumentsList?.some((argument) => isLocationReference(argument, globalAliases, navigationAliases, locationAliases, reflectAliases, objectAliases, reflectionFunctionAliases))) { blocked = true; return }
    if (property === 'navigate' || ['set', 'defineProperty'].includes(property ?? '') && isGlobalObject(argumentsList?.[0], globalAliases) && (constantString(argumentsList?.[1]) === null || ['location', 'navigation'].includes(constantString(argumentsList?.[1]) ?? ''))) { blocked = true; return }
    if (property === 'construct' && (identifierName(argumentsList?.[0]) === 'Function' || isDynamicConstructorReference(argumentsList?.[0]))) { blocked = true; return }
    if (property === 'sendBeacon' && identifierName(owner) === 'navigator') { blocked = true; return }
    if (['insertAdjacentHTML', 'createContextualFragment', 'write', 'writeln'].includes(property ?? '')) { blocked = true; return }
    if (['createElement', 'createElementNS'].includes(property ?? '') && identifierName(owner) === 'document') {
      const requested = constantString(argumentsList?.[property === 'createElementNS' ? 1 : 0])
      if (requested?.toLowerCase() === 'script') blocked = true
    }
  })
  return blocked
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
