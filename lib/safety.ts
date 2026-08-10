const ASSIGNMENT_SECRET = /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|AUTH)[A-Z0-9_]*)\s*([=:])\s*(["'])?([^\s"'`<]{4,})\3/gi
const BEARER_SECRET = /\b(Bearer)\s+[A-Za-z0-9._~-]{4,}/gi
const COMMON_TOKEN = /\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,})\b/g

/** Removes credential-shaped values before generated content crosses a trust boundary. */
export function redactSensitiveValues(value: string) {
  return value
    .replace(ASSIGNMENT_SECRET, '$1$2[REDACTED]')
    .replace(BEARER_SECRET, '$1 [REDACTED]')
    .replace(COMMON_TOKEN, '[REDACTED]')
}
