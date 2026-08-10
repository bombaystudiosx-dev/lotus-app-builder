const SECRET_KEY_NAME = String.raw`(?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|AUTH)[A-Z0-9_]*|[a-z]+(?:Key|Token|Secret|Password|Auth)|[a-z]+_(?:key|token|secret|password|auth))`
const QUOTED_ASSIGNMENT_SECRET = new RegExp(`\\b(${SECRET_KEY_NAME})\\s*([=:])(\\s*)(["'])[^"']*\\4`, 'g')
const UNQUOTED_ASSIGNMENT_SECRET = new RegExp(`\\b(${SECRET_KEY_NAME})\\s*([=:])(\\s*)([^\\s"'\`<;,}\\]]{4,})`, 'g')
const BEARER_SECRET = /\b(Bearer)\s+[A-Za-z0-9._~-]{4,}/gi
const COMMON_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{20,255}|glpat-[A-Za-z0-9_-]{20,255}|sk_(?:live|test)_[A-Za-z0-9_-]{8,}|rk_(?:live|test)_[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{20,}|vcp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g
const PRIVATE_KEY = /-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g

/** Removes credential-shaped values before generated content crosses a trust boundary. */
export function redactSensitiveValues(value: string) {
  return value
    .replace(QUOTED_ASSIGNMENT_SECRET, '$1$2$3$4[REDACTED]$4')
    .replace(UNQUOTED_ASSIGNMENT_SECRET, '$1$2$3[REDACTED]')
    .replace(BEARER_SECRET, '$1 [REDACTED]')
    .replace(COMMON_TOKEN, '[REDACTED]')
    .replace(PRIVATE_KEY, '[REDACTED PRIVATE KEY]')
}
