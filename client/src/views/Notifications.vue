<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { interactApi } from '../api'
import { useUserStore } from '../stores/user'
import AppPagination from '../components/AppPagination.vue'
import AppEmpty from '../components/AppEmpty.vue'
import UserAvatar from '../components/UserAvatar.vue'
import { usePagination } from '../composables/usePagination'
import type { Notification, NotificationType } from '../types/api'
import { useHorizontalDrag } from '../composables/useHorizontalDrag'
import { useSelectionIndicator } from '../composables/useSelectionIndicator'

const router = useRouter(),
  userStore = useUserStore()
const list = ref<Notification[]>([]),
  loading = ref(true),
  error = ref(''),
  notice = ref('')
const tab = ref<'all' | 'unread'>('all'),
  type = ref('')
const categoryTabs = ref<HTMLElement | null>(null)
const categoryDrag = useHorizontalDrag(categoryTabs, [type])
const categoryIndicator = useSelectionIndicator(categoryTabs, [type])
const detail = ref<Notification | null>(null),
  dialog = ref<HTMLDialogElement | null>(null)
const marking = ref(false),
  reading = ref(false),
  jumping = ref(false),
  readError = ref('')
const cutoff = ref(0)
const { page, total, pageCount, pageSize, reset, go } = usePagination(20)
const labels: Record<NotificationType, string> = {
  like: '点赞',
  comment: '评论',
  reply: '回复',
  follow: '关注',
  audit: '审核结果',
  system: '系统通知',
}
const system = (n: Notification) => n.type === 'audit' || n.type === 'system'
const sender = (n: Notification) => (system(n) ? labels[n.type] : n.nickname || n.username || '已注销用户')
const time = (v?: string) =>
  v ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
const verbs: Partial<Record<NotificationType, string>> = {
  like: '赞了你的文章',
  comment: '评论了你的文章',
  reply: '回复了你的评论',
  follow: '关注了你',
}
const shortTime = (value?: string) => {
  if (!value) return '—'
  const date = new Date(value)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  if (date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) === today)
    return date.toLocaleTimeString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  return date.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}
function selectType(value: string) {
  type.value = value
  filter()
}
const hasTarget = (n: Notification) => ['post', 'user', 'creatorship'].includes(n.target_type || '')
let alive = true,
  ticket = 0,
  returnFocus: HTMLElement | null = null,
  oldOverflow = ''
const session = userStore.token
const current = () => alive && session === userStore.token
async function load() {
  const id = ++ticket
  loading.value = true
  error.value = ''
  try {
    const r = await interactApi.getNotifications({
      page: page.value,
      pageSize,
      unread: tab.value === 'unread' ? 1 : undefined,
      type: type.value || undefined,
    })
    if (!current() || id !== ticket) return
    total.value = r.data.total
    cutoff.value = r.data.cutoff_id
    if (page.value > pageCount.value) {
      page.value = pageCount.value
      return load()
    }
    list.value = r.data.list
    void userStore.refreshUnread()
  } catch {
    if (current() && id === ticket) error.value = '通知加载失败，请重试'
  } finally {
    if (current() && id === ticket) loading.value = false
  }
}
function filter(next?: 'all' | 'unread') {
  if (next) tab.value = next
  reset()
  void load()
}
function goPage(p: number) {
  if (!loading.value && go(p)) void load()
}
async function markAll() {
  if (marking.value || loading.value) return
  marking.value = true
  notice.value = ''
  userStore.invalidateUnread()
  const bound = cutoff.value,
    selectedType = type.value
  try {
    await interactApi.markAllRead(bound, selectedType || undefined)
    if (!current()) return
    notice.value = '已标记为已读'
    reset()
    await load()
  } catch {
    if (current()) notice.value = '标记失败，请重试'
  } finally {
    if (current()) {
      marking.value = false
      void userStore.refreshUnread()
    }
  }
}
async function markOne(n: Notification) {
  if (reading.value || n.is_read) return
  reading.value = true
  readError.value = ''
  userStore.invalidateUnread()
  try {
    await interactApi.markRead(n.id)
    if (!current()) return
    n.is_read = 1
    // 不移除正在阅读的条目、不重载背景列表。下次刷新或切换筛选再同步分页。
    void userStore.refreshUnread()
  } catch {
    if (current() && detail.value?.id === n.id) readError.value = '未能标记已读，请重试'
  } finally {
    if (current()) {
      reading.value = false
      if (detail.value && detail.value.id !== n.id && !detail.value.is_read) void markOne(detail.value)
    }
  }
}
async function open(n: Notification) {
  if (detail.value) return
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  detail.value = n
  readError.value = ''
  notice.value = ''
  await nextTick()
  if (!current()) return
  oldOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  dialog.value?.showModal()
  void markOne(n)
}
function close() {
  dialog.value?.close()
  detail.value = null
  document.body.style.overflow = oldOverflow
  returnFocus?.focus({ preventScroll: true })
}
async function goTarget() {
  if (!detail.value || jumping.value) return
  jumping.value = true
  const targetId = detail.value.id
  try {
    const r = await interactApi.getNotificationTarget(targetId)
    if (!current() || detail.value?.id !== targetId) return
    if (!r.data.path) {
      readError.value = r.data.message || '关联内容暂不可访问'
      return
    }
    const path = r.data.path
    close()
    await router.push(path)
  } catch {
    if (current()) readError.value = '无法打开关联内容，请重试'
  } finally {
    if (current()) jumping.value = false
  }
}
onMounted(() => void load())
onBeforeUnmount(() => {
  alive = false
  ticket++
  if (detail.value) {
    dialog.value?.close()
    document.body.style.overflow = oldOverflow
  }
})
</script>

<template>
  <div class="notifications-page">
    <header class="heading">
      <div class="title-line">
        <h2>消息通知</h2>
        <span v-if="userStore.unreadCount" class="count"
          >{{ userStore.unreadCount > 99 ? '99+' : userStore.unreadCount }} 条未读</span
        >
      </div>
      <div class="header-actions">
        <button
          class="quiet-button"
          :disabled="loading || marking"
          aria-label="刷新通知"
          title="刷新通知"
          @click="load"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            aria-hidden="true"
          >
            <path d="M20 7v5h-5M4 17v-5h5" />
            <path d="M6.1 7a7 7 0 0 1 11.7-1L20 9M4 15l2.2 3A7 7 0 0 0 18 17" />
          </svg>
        </button>
        <button
          class="quiet-button"
          :disabled="!cutoff || marking || loading"
          :title="type ? '将当前类型截至本次查询的通知标为已读' : '将截至本次查询的通知标为已读，新消息不受影响'"
          @click="markAll"
        >
          {{ marking ? '处理中…' : type ? '此类已读' : '全部已读' }}
        </button>
      </div>
    </header>
    <nav ref="categoryTabs" class="category-tabs" :class="{ 'is-dragging': categoryDrag.dragging.value, 'has-indicator': categoryIndicator.ready.value }" aria-label="通知分类，可横向拖动" @pointerdown="categoryDrag.start" @click.capture="categoryDrag.guardClick" @focusin="categoryDrag.focus" @dragstart.prevent>
      <span v-if="categoryIndicator.ready.value" class="selection-indicator" :class="{ 'is-moving': categoryIndicator.moving.value }" :style="categoryIndicator.style.value" aria-hidden="true" />
      <button :aria-pressed="!type" :class="{ active: !type }" @click="selectType('')"><span>全部</span></button>
      <button
        v-for="(label, value) in labels"
        :key="value"
        :aria-pressed="type === value"
        :class="{ active: type === value }"
        @click="selectType(value)"
      >
        <span>{{ label }}</span>
      </button>
    </nav>
    <div class="feed-toolbar">
      <span>{{ type ? labels[type as NotificationType] : '全部消息' }}</span>
      <label class="unread-switch"
        ><input
          type="checkbox"
          :checked="tab === 'unread'"
          @change="filter(tab === 'all' ? 'unread' : 'all')"
        />只看未读</label
      >
    </div>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <AppEmpty
      v-if="loading || error || !list.length"
      :loading="loading"
      :error="error"
      :empty-text="tab === 'unread' ? '没有未读消息' : '暂时没有这类消息'"
      @retry="load"
    />
    <template v-else>
      <div class="notification-list">
        <button v-for="n in list" :key="n.id" class="notification-row" :class="{ unread: !n.is_read }" @click="open(n)">
          <span class="avatar-wrap">
            <span v-if="system(n)" class="system-avatar">
              <svg
                v-if="n.type === 'audit'"
                width="21"
                height="21"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                aria-hidden="true"
              >
                <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
                <path d="m8 12 3 3 5-6" />
              </svg>
              <svg
                v-else
                width="21"
                height="21"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                aria-hidden="true"
              >
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
              </svg>
            </span>
            <UserAvatar v-else :src="n.avatar" :name="sender(n)" :size="40" />
            <span v-if="!n.is_read" class="unread-dot" aria-label="未读"></span>
          </span>
          <span class="row-body">
            <span class="row-heading"
              ><span class="headline"
                ><strong>{{ sender(n) }}</strong
                ><span v-if="!system(n)" class="verb">{{ verbs[n.type] }}</span></span
              ><time :datetime="n.created_at" :title="time(n.created_at)">{{ shortTime(n.created_at) }}</time></span
            >
            <span v-if="system(n)" class="content">{{ n.content }}</span>
            <span v-else-if="n.type === 'comment' || n.type === 'reply'" class="reply-preview">{{ n.content }}</span>
            <span v-if="n.context_title" class="context">{{ n.context_title }}</span>
          </span>
        </button>
      </div>
      <AppPagination :page="page" :page-count="pageCount" @change="goPage" />
    </template>
    <Teleport to="body"
      ><dialog
        ref="dialog"
        class="notification-dialog"
        aria-labelledby="notification-title"
        @cancel.prevent="close"
        @click="
          (e) => {
            if (e.target === dialog) close()
          }
        "
      >
        <div v-if="detail" class="dialog-body">
          <header>
            <div>
              <h2 id="notification-title">{{ labels[detail.type] }}</h2>
              <p>{{ system(detail) ? '系统发送' : sender(detail) }} · {{ time(detail.created_at) }}</p>
            </div>
            <button aria-label="关闭通知详情" autofocus @click="close">×</button>
          </header>
          <p v-if="detail.context_title" class="detail-context">{{ detail.context_title }}</p>
          <p class="detail-content">{{ detail.content }}</p>
          <p v-if="hasTarget(detail) && !detail.target_available" class="notice">
            关联内容可能已删除或暂不可访问，打开时将再次检查。
          </p>
          <p v-if="readError" role="alert" class="notice">{{ readError }}</p>
          <div class="dialog-actions">
            <button v-if="!detail.is_read" :disabled="reading" @click="markOne(detail)">
              {{ reading ? '正在标记已读…' : '重试标记已读' }}</button
            ><button v-if="hasTarget(detail)" class="primary" :disabled="jumping" @click="goTarget">
              {{
                jumping
                  ? '检查关联内容…'
                  : detail.target_type === 'creatorship'
                    ? '查看申请结果'
                    : detail.target_type === 'user'
                      ? '查看用户'
                      : detail.comment_id
                        ? '查看评论'
                        : '查看文章'
              }}
            </button>
          </div>
        </div>
      </dialog></Teleport
    >
  </div>
</template>

<style scoped>
.notifications-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 30px 24px 44px;
  color: var(--text-primary);
}
.heading,
.title-line,
.header-actions,
.feed-toolbar,
.row-heading,
.dialog-body header {
  display: flex;
  align-items: center;
}
.heading {
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 24px;
}
.title-line {
  gap: 12px;
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--text-primary);
}
.count {
  font-size: 0.73rem;
  color: var(--text-muted);
  white-space: nowrap;
}
.header-actions {
  gap: 6px;
  flex-shrink: 0;
}
button {
  font: inherit;
  color: var(--text-secondary);
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 3px;
}
.quiet-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  min-height: 36px;
  padding: 6px 8px;
  font-size: 0.78rem;
  border-radius: 6px;
}
.quiet-button:hover:not(:disabled) {
  color: var(--amber);
  background: var(--bg-hover);
}
.category-tabs {
  position: relative;
  display: flex;
  gap: 26px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border-subtle);
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
  user-select: none;
  cursor: grab;
}
.category-tabs::-webkit-scrollbar { display:none; }
.category-tabs .selection-indicator { display:none; }
.category-tabs button { cursor:grab; }
.category-tabs.is-dragging, .category-tabs.is-dragging button { cursor:grabbing; }
.category-tabs button:focus-visible { outline-offset:-2px; }
.category-tabs button {
  position: relative;
  flex-shrink: 0;
  padding: 0 0 14px;
  border: 0;
  background: transparent;
  font-size: 0.86rem;
  min-height: 38px;
}
.category-tabs button.active {
  color: var(--amber);
  font-weight: 600;
}
.category-tabs button.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--amber);
}
.feed-toolbar {
  justify-content: space-between;
  margin: 18px 0 8px;
  font-size: 0.75rem;
  color: var(--text-muted);
}
.unread-switch {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}
.unread-switch input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--amber);
}
.notice {
  color: var(--amber);
  font-size: 0.8rem;
  line-height: 1.6;
}
.notification-list {
  border: 0;
}
.notification-row {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 8px;
  border: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
  text-align: left;
}
.notification-row:hover {
  background: var(--bg-hover);
}
.avatar-wrap {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}
.system-avatar {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--amber);
  background: var(--amber-glow);
}
.unread-dot {
  position: absolute;
  right: -2px;
  top: -2px;
  width: 7px;
  height: 7px;
  border: 2px solid var(--bg-deep);
  border-radius: 50%;
  background: var(--amber);
}
.row-body {
  display: flex;
  flex-direction: column;
  gap: 9px;
  flex: 1;
  min-width: 0;
}
.row-heading {
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
.headline {
  font-size: 0.85rem;
  line-height: 1.65;
  min-width: 0;
  overflow-wrap: anywhere;
}
.headline strong {
  font-weight: 600;
  color: var(--text-primary);
}
.verb {
  margin-left: 8px;
  color: var(--text-secondary);
  font-size: 0.81rem;
}
time {
  font-size: 0.7rem;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.content,
.reply-preview,
.context {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  line-height: 1.7;
  font-size: 0.83rem;
  color: var(--text-secondary);
}
.reply-preview {
  border-left: 2px solid var(--border-subtle);
  padding-left: 10px;
}
.context {
  font-size: 0.76rem;
  color: var(--text-muted);
  -webkit-line-clamp: 1;
}
.context::before {
  content: '《';
}
.context::after {
  content: '》';
}
.notification-dialog {
  inset: 0;
  margin: auto;
  width: min(500px, calc(100% - 28px));
  max-height: calc(100dvh - 48px);
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: var(--bg-card);
  color: var(--text-primary);
  overflow-y: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.2);
}
.notification-dialog::backdrop {
  background: rgba(0, 0, 0, 0.32);
}
.dialog-body {
  padding: 24px;
}
.dialog-body header {
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.dialog-body h2 {
  font-size: 1rem;
}
.dialog-body header p {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 8px 0 0;
  line-height: 1.6;
}
.dialog-body button {
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  padding: 8px 12px;
  font-size: 0.8rem;
  min-height: 36px;
}
.dialog-body header button {
  border: 0;
  font-size: 1.25rem;
  flex-shrink: 0;
  padding: 2px 9px;
}
.detail-content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
  font-size: 0.88rem;
  margin: 24px 0;
}
.detail-context {
  border-left: 2px solid var(--border-subtle);
  padding-left: 12px;
  font-size: 0.8rem;
  color: var(--text-muted);
  overflow-wrap: anywhere;
  line-height: 1.7;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.dialog-actions .primary {
  background: var(--amber);
  color: var(--on-amber);
  border-color: var(--amber);
}
@media (max-width: 767px) {
  .category-tabs { gap:6px; padding:4px 0; border-bottom:0; }
  .category-tabs button { padding:7px 14px; min-height:34px; border:1px solid var(--border-subtle); border-radius:20px; background:var(--bg-card); font-size:.8rem; white-space:nowrap; transition:color 180ms ease, background-color 180ms ease, border-color 180ms ease; }
  .category-tabs button > span { position:relative; z-index:2; }
  .category-tabs button.active { color:var(--on-amber); background:var(--amber); border-color:var(--amber); font-weight:500; }
  .category-tabs button.active::after { display:none; }
  .category-tabs.has-indicator button.active { background:transparent; border-color:transparent; }
  .category-tabs .selection-indicator { display:block; z-index:1; }
}
@media (max-width: 520px) {
  .notifications-page {
    padding: 22px 16px 32px;
  }
  .heading {
    align-items: flex-start;
    margin-bottom: 20px;
  }
  .title-line {
    flex-wrap: wrap;
    gap: 5px 10px;
  }
  .count {
    font-size: 0.7rem;
  }
  .category-tabs button {
    font-size: 0.8rem;
  }
  .notification-row {
    padding: 18px 0;
    gap: 12px;
  }
  .row-heading {
    gap: 8px;
    flex-wrap: wrap;
  }
  .row-heading time {
    font-size: 0.68rem;
  }
  .headline {
    font-size: 0.83rem;
  }
  .verb {
    font-size: 0.78rem;
  }
  .dialog-body {
    padding: 20px;
  }
}
@media (prefers-reduced-motion: reduce) { .category-tabs button { transition:none; } }
@media (prefers-reduced-motion: no-preference) {
  .notification-dialog[open] {
    animation: appear 0.16s ease-out;
  }
  @keyframes appear {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
}
</style>
