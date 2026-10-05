function safePath(url) { return String(url || '').split('?')[0].replace(/[\r\n\x00-\x1f]/g, '').slice(0,200) }
function redact(text) {
  return String(text || '')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/((?:password|passwd|token|secret|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
}
module.exports = { safePath, redact }
