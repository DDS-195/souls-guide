import type { GuideInfo, PostPayload } from '../types/api'
export interface WritingDraft {
  form: { title: string; content: string; game_id: number; category: string; tags: string }
  video: string | null
  cover: string | null
  savedId: number
  version: number
  originalGameId: number
  pendingCreate: { request_id: string; payload: PostPayload } | null
  savedAt: number
  guide?: GuideInfo
  chapterText?: string
}
export function draftKey(userId: number, article: string): string { return `sg_writing_v1:${userId}:${article}` }
export function readWritingDraft(key: string): WritingDraft | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null') as WritingDraft | null
    if (!value || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt > 7 * 86400000 || !value.form ||
        ['title', 'content', 'category', 'tags'].some(k => typeof value.form[k as keyof typeof value.form] !== 'string') ||
        !Number.isSafeInteger(value.form.game_id) || !Number.isSafeInteger(value.savedId) || value.savedId < 0 ||
        !Number.isSafeInteger(value.version) || value.version < 1 || !Number.isSafeInteger(value.originalGameId) ||
        (value.video !== null && typeof value.video !== 'string') || (value.cover !== null && typeof value.cover !== 'string')) return null
    if (value.pendingCreate !== null) {
      const pending = value.pendingCreate
      if (!pending || typeof pending.request_id !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(pending.request_id) || !pending.payload ||
          ['title','content','category'].some(k => typeof pending.payload[k as keyof PostPayload] !== 'string') ||
          !Number.isSafeInteger(pending.payload.game_id) || !Array.isArray(pending.payload.tags) || pending.payload.tags.some(t => typeof t !== 'string')) return null
    }
    if (value.chapterText !== undefined && typeof value.chapterText !== 'string') return null
    if (value.guide !== undefined && (!value.guide || ['summary','game_version','prerequisites'].some(k => typeof value.guide![k as keyof GuideInfo] !== 'string') || !['none','minor','major'].includes(value.guide.spoiler) || !Array.isArray(value.guide.video_chapters) || value.guide.video_chapters.some(c => !c || !Number.isSafeInteger(c.seconds) || typeof c.title !== 'string'))) return null
    return value
  } catch { return null }
}
export function storeWritingDraft(key: string, draft: WritingDraft): boolean {
  try { localStorage.setItem(key, JSON.stringify(draft)); return true } catch { return false }
}
export function removeWritingDraft(key: string) { try { localStorage.removeItem(key) } catch { /* Local storage may be blocked. */ } }
