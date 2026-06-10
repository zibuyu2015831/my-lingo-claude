const REDACTION_RULES = [
  // API keys / tokens (sk-, Bearer, ghp_, gho_)
  {
    name: 'api_key',
    pattern: /\b(sk-[a-zA-Z0-9\-_]{20,}|Bearer\s+[a-zA-Z0-9\-_.]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36})\b/g,
    replacement: '[API_KEY]',
  },
  // Passwords in DB connection strings
  {
    name: 'db_password',
    pattern: /((?:postgres|mysql|mongodb|redis):\/\/[^:]+:)[^@\s]+(@)/g,
    replacement: '$1[PASS]$2',
  },
  // Generic password= / secret= / token= patterns
  {
    name: 'password_param',
    pattern: /\b(password|passwd|pwd|secret|token)\s*[=:]\s*\S+/gi,
    replacement: '$1=[REDACTED]',
  },
  // PEM private key blocks
  {
    name: 'private_key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[PRIVATE_KEY]',
  },
  // Home directory paths with username
  {
    name: 'home_path',
    pattern: /\/(home|Users)\/([a-zA-Z0-9_\-]+)\//g,
    replacement: '/$1/[USER]/',
  },
  // Private IP addresses (RFC 1918)
  {
    name: 'private_ip',
    pattern: /\b(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    replacement: '[PRIVATE_IP]',
  },
  // AWS-style access keys
  {
    name: 'aws_key',
    pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: '[AWS_ACCESS_KEY]',
  },
]

export function redact(text, privacyMode = 'standard') {
  if (privacyMode === 'off') return text
  let result = text
  for (const rule of REDACTION_RULES) {
    result = result.replace(rule.pattern, rule.replacement)
  }
  return result
}

// Redact every string `content` in a chat-completions `messages` array. This is
// the single outbound chokepoint: callFastModel / callDeepModel apply it right
// before curl, so EVERY external request is scrubbed — including the SessionEnd
// analysis and lesson paths, which read raw prompts back out of SQLite. Keeping
// redaction at the API boundary (not at each call site) means a newly added API
// path is protected by default. See dev_docs/14 / ARCHITECTURE_REVIEW F2.
export function redactMessages(messages, privacyMode = 'standard') {
  if (privacyMode === 'off' || !Array.isArray(messages)) return messages
  return messages.map(m =>
    m && typeof m.content === 'string'
      ? { ...m, content: redact(m.content, privacyMode) }
      : m
  )
}
