<script setup lang="ts">
import { safeStorage } from '../utils/storage'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { announcementApi } from '../api'
import { useUserStore } from '../stores/user'
import type { Announcement } from '../types/api'

const STORAGE_KEY = 'dismissedAnnouncementVersions'
const MAX_LOCAL_DISMISSALS = 100
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

const userStore = useUserStore()
const visible = ref(false)
const announcement = ref<Announcement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let refreshTimer: number | undefined
let loading = false
let previousFocus: HTMLElement | null = null

function announcementKey(item: Announcement) {
  return `${item.id}:${item.version}`
}

function readLocalDismissals() {
  try {
    const parsed: unknown = JSON.parse(safeStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string').slice(-MAX_LOCAL_DISMISSALS)
  } catch {
    safeStorage.removeItem(STORAGE_KEY)
    return []
  }
}

function rememberLocalDismissal(key: string) {
  const next = readLocalDismissals().filter((item) => item !== key)
  next.push(key)
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-MAX_LOCAL_DISMISSALS)))
}

async function loadLatest() {
  if (loading || document.hidden) return
  loading = true
  try {
    const response = await announcementApi.getLatest()
    const latest = response.data
    if (!latest) {
      announcement.value = null
      visible.value = false
      return
    }
    const dismissedLocally = readLocalDismissals().includes(announcementKey(latest))
    announcement.value = latest
    visible.value = !dismissedLocally && latest.is_read !== 1
  } catch {
    // 公告不可用不应阻断站点主体功能。
  } finally {
    loading = false
  }
}

function dismiss() {
  const current = announcement.value
  visible.value = false
  if (!current) return
  rememberLocalDismissal(announcementKey(current))
  if (userStore.isLoggedIn) announcementApi.markRead(current.id, current.version).catch(() => {})
}

function onKeydown(event: KeyboardEvent) {
  if (visible.value && event.key === 'Escape') dismiss()
}

function onFocus() {
  loadLatest()
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') loadLatest()
}

watch(visible, async (isVisible) => {
  if (isVisible) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    closeButton.value?.focus()
  } else {
    previousFocus?.focus()
    previousFocus = null
  }
})

onMounted(() => {
  loadLatest()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
  refreshTimer = window.setInterval(loadLatest, REFRESH_INTERVAL_MS)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('focus', onFocus)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="dismiss">
      <section
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-dialog-title"
        aria-describedby="announcement-dialog-content"
      >
        <header class="modal-header">
          <span id="announcement-dialog-title">📢 {{ announcement?.title }}</span>
          <button ref="closeButton" class="modal-close" type="button" aria-label="关闭公告" @click="dismiss">✕</button>
        </header>
        <div id="announcement-dialog-content" class="modal-body">{{ announcement?.content }}</div>
        <footer class="modal-footer">
          <span v-if="announcement?.published_at" class="published-time">
            发布于 {{ announcement.published_at.replace('T', ' ').slice(0, 16) }}
          </span>
          <button type="button" @click="dismiss">我知道了</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.7); }
.modal-card { width: 100%; max-width: 460px; overflow: hidden; background: var(--bg-card); border: 1px solid rgba(232,168,56,.2); border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 18px 20px; color: var(--amber); border-bottom: 1px solid var(--border-subtle); font-family: Cinzel, serif; font-size: 1rem; font-weight: 600; }
.modal-close { width: 32px; height: 32px; padding: 0; color: var(--text-muted); background: transparent; border: 0; border-radius: 6px; cursor: pointer; font-size: 1rem; }
.modal-close:hover, .modal-close:focus-visible { color: var(--text-primary); background: var(--bg-hover); outline: 1px solid var(--amber); }
.modal-body { max-height: min(55vh, 520px); overflow-y: auto; padding: 20px; color: var(--text-primary); font-size: .9rem; line-height: 1.75; overflow-wrap: anywhere; white-space: pre-wrap; }
.modal-footer { display: flex; align-items: center; gap: 12px; padding: 0 20px 18px; }
.published-time { flex: 1; color: var(--text-muted); font-size: .68rem; }
.modal-footer button { margin-left: auto; padding: 9px 18px; color: var(--on-amber); background: var(--amber); border: 0; border-radius: 8px; cursor: pointer; font: inherit; font-size: .86rem; font-weight: 600; }
</style>
