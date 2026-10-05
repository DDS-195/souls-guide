import { safeStorage } from './storage'
const VISITOR_KEY = 'soulsGuideVisitorId'

export function getAnalyticsVisitorId(): string {
  const existing = safeStorage.getItem(VISITOR_KEY)
  if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing
  const generated = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`
  safeStorage.setItem(VISITOR_KEY, generated)
  return generated
}
