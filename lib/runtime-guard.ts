import { parse } from 'acorn'

type AstNode = { type: string; start: number; end: number; body?: AstNode; [key: string]: unknown }
type ReflectionKind = 'apply' | 'get' | 'getOwnPropertyDescriptor' | 'getOwnPropertyDescriptors' | 'getPrototypeOf' | 'lookupGetter'
type ReflectionCall = { kind: ReflectionKind; args: AstNode[] | null; receiver?: AstNode }

const GUARD_MARKER = '/* lotus-runtime-guard */'
const MAX_ALIAS_PASSES = 64
const MAX_BINDING_DEPTH = 32
const MAX_BINDING_STEPS = 8_192

type AliasState = {
  globalAliases: Set<string>
  navigationAliases: Set<string>
  locationAliases: Set<string>
  reflectAliases: Set<string>
  objectAliases: Set<string>
  reflectionFunctionAliases: Map<string, ReflectionKind>
}

type BindingResult = { blocked: boolean; changed: boolean }
type FunctionDefinitions = Map<string, Set<AstNode>>

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

function mergeBindingResult(target: BindingResult, source: BindingResult) {
  target.blocked ||= source.blocked
  target.changed ||= source.changed
}

function addAlias(aliases: Set<string>, name: string) {
  if (aliases.has(name)) return false
  aliases.add(name)
  return true
}

function setReflectionAlias(aliases: Map<string, ReflectionKind>, name: string, kind: ReflectionKind) {
  if (aliases.get(name) === kind) return false
  aliases.set(name, kind)
  return true
}

function syntheticMember(value: AstNode, key: string | number): AstNode {
  return {
    type: 'MemberExpression',
    start: value.start,
    end: value.end,
    object: value,
    property: { type: 'Literal', start: value.start, end: value.end, value: key },
    computed: true,
  }
}

function propertyValue(value: AstNode, key: string | number): AstNode {
  if (value.type === 'ObjectExpression') {
    const properties = (value.properties as AstNode[] | undefined) ?? []
    for (const property of [...properties].reverse()) {
      if (property.type === 'SpreadElement') continue
      const propertyKey = constantString(property.key as AstNode) ?? identifierName(property.key as AstNode)
      if (propertyKey === String(key)) return property.value as AstNode
    }
    const spread = [...properties].reverse().find((property) => property.type === 'SpreadElement')?.argument as AstNode | undefined
    if (spread) return propertyValue(spread, key)
  }
  if (value.type === 'ArrayExpression' && typeof key === 'number') {
    const element = (value.elements as Array<AstNode | null> | undefined)?.[key]
    if (element?.type === 'SpreadElement') return element.argument as AstNode
    if (element) return element
  }
  return syntheticMember(value, key)
}

function arrayValue(values: AstNode[], anchor: AstNode): AstNode {
  return { type: 'ArrayExpression', start: anchor.start, end: anchor.end, elements: values }
}

function recordIdentifierAlias(name: string, value: AstNode | undefined, state: AliasState): BindingResult {
  const result = { blocked: false, changed: false }
  if (!value) return result
  if (isBuiltin(value, 'Reflect', state.reflectAliases)) result.changed = addAlias(state.reflectAliases, name) || result.changed
  if (isBuiltin(value, 'Object', state.objectAliases)) result.changed = addAlias(state.objectAliases, name) || result.changed
  const kind = reflectionKind(value, state.reflectAliases, state.objectAliases, state.reflectionFunctionAliases)
  if (kind) result.changed = setReflectionAlias(state.reflectionFunctionAliases, name, kind) || result.changed
  if (isGlobalObject(value, state.globalAliases)) result.changed = addAlias(state.globalAliases, name) || result.changed
  if (isNavigationContainer(value, state.globalAliases, state.navigationAliases, state.reflectAliases, state.objectAliases, state.reflectionFunctionAliases)) {
    result.changed = addAlias(state.navigationAliases, name) || result.changed
  }
  if (isLocationReference(value, state.globalAliases, state.navigationAliases, state.locationAliases, state.reflectAliases, state.objectAliases, state.reflectionFunctionAliases)) {
    result.changed = addAlias(state.locationAliases, name) || result.changed
  }
  return result
}

function mayBeUndefined(value: AstNode | undefined, state: AliasState) {
  if (!value) return true
  if (value.type === 'Literal') return value.value === undefined
  if (['ObjectExpression', 'ArrayExpression', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassExpression', 'TemplateLiteral', 'ThisExpression', 'NewExpression'].includes(value.type)) return false
  if (value.type !== 'Identifier') return true
  return !isBuiltin(value, 'Reflect', state.reflectAliases)
    && !isBuiltin(value, 'Object', state.objectAliases)
    && !isGlobalObject(value, state.globalAliases)
    && identifierName(value) !== 'document'
    && identifierName(value) !== 'location'
}

function bindAliasPattern(
  pattern: AstNode | undefined,
  value: AstNode | undefined,
  state: AliasState,
  budget: { remaining: number },
  depth = 0,
): BindingResult {
  const result = { blocked: false, changed: false }
  if (!pattern) return result
  budget.remaining -= 1
  if (budget.remaining < 0 || depth > MAX_BINDING_DEPTH) return { blocked: true, changed: false }
  if (pattern.type === 'Identifier') return recordIdentifierAlias(identifierName(pattern) as string, value, state)
  if (pattern.type === 'AssignmentPattern') {
    if (value) mergeBindingResult(result, bindAliasPattern(pattern.left as AstNode, value, state, budget, depth + 1))
    if (mayBeUndefined(value, state)) mergeBindingResult(result, bindAliasPattern(pattern.left as AstNode, pattern.right as AstNode, state, budget, depth + 1))
    return result
  }
  if (pattern.type === 'RestElement') return bindAliasPattern(pattern.argument as AstNode, value, state, budget, depth + 1)
  if (pattern.type === 'ArrayPattern') {
    for (const [index, element] of ((pattern.elements as Array<AstNode | null> | undefined) ?? []).entries()) {
      if (!element) continue
      if (element.type === 'RestElement') {
        const source = value?.type === 'ArrayExpression'
          ? arrayValue(((value.elements as Array<AstNode | null> | undefined) ?? []).slice(index).filter((item): item is AstNode => Boolean(item)), value)
          : value
        mergeBindingResult(result, bindAliasPattern(element.argument as AstNode, source, state, budget, depth + 1))
      } else {
        mergeBindingResult(result, bindAliasPattern(element, value ? propertyValue(value, index) : undefined, state, budget, depth + 1))
      }
    }
    return result
  }
  if (pattern.type !== 'ObjectPattern') return result
  if (value && objectPatternRequestsBlockedCapability(pattern, value, state.globalAliases, state.navigationAliases, state.locationAliases, state.reflectAliases, state.objectAliases, state.reflectionFunctionAliases)) {
    result.blocked = true
  }
  for (const property of pattern.properties as AstNode[] | undefined ?? []) {
    if (property.type === 'RestElement') {
      mergeBindingResult(result, bindAliasPattern(property.argument as AstNode, value, state, budget, depth + 1))
      continue
    }
    const key = constantString(property.key as AstNode) ?? identifierName(property.key as AstNode)
    if (key === null) {
      if (value && isReflectionNamespace(value, state.reflectAliases, state.objectAliases)) result.blocked = true
      continue
    }
    const kind = value ? destructuredReflectionKind(value, key, state.reflectAliases, state.objectAliases) : null
    if (kind) result.blocked = true
    mergeBindingResult(result, bindAliasPattern(property.value as AstNode, value ? propertyValue(value, key) : undefined, state, budget, depth + 1))
  }
  return result
}

function inferredParameterReflectionKind(key: string | null): ReflectionKind | null {
  if (key === 'apply' || key === 'get') return key
  if (['getOwnPropertyDescriptor', 'getOwnPropertyDescriptors', 'getPrototypeOf'].includes(key ?? '')) return key as ReflectionKind
  if (key === '__lookupGetter__' || key === '__lookupSetter__') return 'lookupGetter'
  return null
}

function inferParameterReflectionAliases(
  pattern: AstNode | undefined,
  state: AliasState,
  budget: { remaining: number },
  depth = 0,
): BindingResult {
  const result = { blocked: false, changed: false }
  if (!pattern) return result
  budget.remaining -= 1
  if (budget.remaining < 0 || depth > MAX_BINDING_DEPTH) return { blocked: true, changed: false }
  if (pattern.type === 'AssignmentPattern') return inferParameterReflectionAliases(pattern.left as AstNode, state, budget, depth + 1)
  if (pattern.type === 'RestElement') return inferParameterReflectionAliases(pattern.argument as AstNode, state, budget, depth + 1)
  if (pattern.type === 'ArrayPattern') {
    for (const element of (pattern.elements as Array<AstNode | null> | undefined) ?? []) {
      if (element) mergeBindingResult(result, inferParameterReflectionAliases(element, state, budget, depth + 1))
    }
    return result
  }
  if (pattern.type !== 'ObjectPattern') return result
  for (const property of pattern.properties as AstNode[] | undefined ?? []) {
    if (property.type === 'RestElement') {
      mergeBindingResult(result, inferParameterReflectionAliases(property.argument as AstNode, state, budget, depth + 1))
      continue
    }
    const key = constantString(property.key as AstNode) ?? identifierName(property.key as AstNode)
    const kind = inferredParameterReflectionKind(key)
    const value = property.value as AstNode | undefined
    const name = value?.type === 'AssignmentPattern' ? identifierName(value.left as AstNode) : identifierName(value)
    if (kind && name) result.changed = setReflectionAlias(state.reflectionFunctionAliases, name, kind) || result.changed
    mergeBindingResult(result, inferParameterReflectionAliases(value, state, budget, depth + 1))
  }
  return result
}

function addFunctionDefinition(definitions: FunctionDefinitions, name: string, value: AstNode) {
  const functions = definitions.get(name) ?? new Set<AstNode>()
  const changed = !functions.has(value)
  functions.add(value)
  definitions.set(name, functions)
  return changed
}

function isFunctionNode(node: AstNode | undefined) {
  return Boolean(node && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type))
}

function resolveFunctionTargets(node: AstNode | undefined, definitions: FunctionDefinitions, depth = 0): AstNode[] {
  if (!node || depth > MAX_BINDING_DEPTH) return []
  if (isFunctionNode(node)) return [node]
  if (node.type === 'ChainExpression') return resolveFunctionTargets(node.expression as AstNode, definitions, depth + 1)
  if (node.type === 'SequenceExpression') {
    const expressions = node.expressions as AstNode[] | undefined
    return resolveFunctionTargets(expressions?.at(-1), definitions, depth + 1)
  }
  const name = identifierName(node)
  if (name) return [...(definitions.get(name) ?? [])]
  if (node.type === 'MemberExpression') {
    const key = memberName(node)
    const owner = node.object as AstNode | undefined
    if (key !== null && owner?.type === 'ObjectExpression') return resolveFunctionTargets(propertyValue(owner, key), definitions, depth + 1)
  }
  return []
}

function callArguments(node: AstNode | undefined): AstNode[] | null {
  if (!node || node.type !== 'ArrayExpression') return null
  const values: AstNode[] = []
  for (const element of (node.elements as Array<AstNode | null> | undefined) ?? []) {
    if (!element) continue
    if (element.type === 'SpreadElement') {
      const expanded = callArguments(element.argument as AstNode)
      if (!expanded) return null
      values.push(...expanded)
    } else values.push(element)
  }
  return values
}

function directCallArguments(args: AstNode[]) {
  const values: AstNode[] = []
  for (const argument of args) {
    if (argument.type !== 'SpreadElement') {
      values.push(argument)
      continue
    }
    const expanded = callArguments(argument.argument as AstNode)
    if (expanded) values.push(...expanded)
  }
  return values
}

function invocationBindings(node: AstNode, definitions: FunctionDefinitions, state: AliasState): Array<{ functions: AstNode[]; args: AstNode[] }> {
  if (node.type !== 'CallExpression' && node.type !== 'NewExpression') return []
  const callee = node.callee as AstNode | undefined
  const rawArgs = (node.arguments as AstNode[] | undefined) ?? []
  if (node.type === 'CallExpression' && callee?.type === 'MemberExpression') {
    const method = memberName(callee)
    if (reflectionKind(callee, state.reflectAliases, state.objectAliases, state.reflectionFunctionAliases) === 'apply') {
      const args = callArguments(rawArgs[2])
      return args ? [{ functions: resolveFunctionTargets(rawArgs[0], definitions), args }] : []
    }
    if (method === 'construct' && isBuiltin(callee.object as AstNode, 'Reflect', state.reflectAliases)) {
      const args = callArguments(rawArgs[1])
      return args ? [{ functions: resolveFunctionTargets(rawArgs[0], definitions), args }] : []
    }
    if (method === 'call') return [{ functions: resolveFunctionTargets(callee.object as AstNode, definitions), args: rawArgs.slice(1) }]
    if (method === 'apply') {
      const args = callArguments(rawArgs[1])
      return args ? [{ functions: resolveFunctionTargets(callee.object as AstNode, definitions), args }] : []
    }
    if (method === 'bind') return [{ functions: resolveFunctionTargets(callee.object as AstNode, definitions), args: rawArgs.slice(1) }]
  }
  return [{ functions: resolveFunctionTargets(callee, definitions), args: directCallArguments(rawArgs) }]
}

function bindFunctionParameters(fn: AstNode, args: AstNode[], state: AliasState, budget: { remaining: number }) {
  const result = { blocked: false, changed: false }
  const params = (fn.params as AstNode[] | undefined) ?? []
  for (const [index, param] of params.entries()) {
    if (param.type === 'RestElement') {
      mergeBindingResult(result, bindAliasPattern(param.argument as AstNode, arrayValue(args.slice(index), fn), state, budget))
      break
    }
    mergeBindingResult(result, bindAliasPattern(param, args[index], state, budget))
  }
  return result
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
  const state: AliasState = { globalAliases, navigationAliases, locationAliases, reflectAliases, objectAliases, reflectionFunctionAliases }
  const functionDefinitions: FunctionDefinitions = new Map()
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration') {
      const name = identifierName(node.id as AstNode)
      if (name) addFunctionDefinition(functionDefinitions, name, node)
      return
    }
    if (node.type !== 'VariableDeclarator' && node.type !== 'AssignmentExpression') return
    const target = (node.id ?? node.left) as AstNode | undefined
    const value = (node.init ?? node.right) as AstNode | undefined
    const name = identifierName(target)
    if (name && isFunctionNode(value)) addFunctionDefinition(functionDefinitions, name, value as AstNode)
  })
  let blockedBinding = false
  let aliasesChanged = true
  let aliasPasses = 0
  while (aliasesChanged && aliasPasses < MAX_ALIAS_PASSES) {
    aliasPasses += 1
    aliasesChanged = false
    const bindingBudget = { remaining: MAX_BINDING_STEPS }
    walk(ast, (node) => {
      if (isFunctionNode(node)) {
        for (const param of (node.params as AstNode[] | undefined) ?? []) {
          const result = inferParameterReflectionAliases(param, state, bindingBudget)
          blockedBinding ||= result.blocked
          aliasesChanged ||= result.changed
        }
      }
      if (node.type === 'VariableDeclarator' || node.type === 'AssignmentExpression') {
        const target = (node.id ?? node.left) as AstNode | undefined
        const value = (node.init ?? node.right) as AstNode | undefined
        const name = identifierName(target)
        const referencedFunctions = resolveFunctionTargets(value, functionDefinitions)
        if (name) {
          for (const referencedFunction of referencedFunctions) {
            if (addFunctionDefinition(functionDefinitions, name, referencedFunction)) aliasesChanged = true
          }
        }
        const result = bindAliasPattern(target, value, state, bindingBudget)
        blockedBinding ||= result.blocked
        aliasesChanged ||= result.changed
      }
      for (const invocation of invocationBindings(node, functionDefinitions, state)) {
        for (const fn of invocation.functions) {
          const result = bindFunctionParameters(fn, invocation.args, state, bindingBudget)
          blockedBinding ||= result.blocked
          aliasesChanged ||= result.changed
        }
      }
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
