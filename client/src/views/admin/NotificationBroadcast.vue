<script setup lang="ts">
import { createRequestId } from '../../utils/requestId'
import { computed, onMounted, ref } from 'vue'
import { adminApi } from '../../api'
import { errorMessage } from '../../utils/errors'
import { toast } from '../../utils/toast'
import AppModal from '../../components/AppModal.vue'
import AppPagination from '../../components/AppPagination.vue'
import { useUserStore } from '../../stores/user'

const content = ref('')
const targetUserId = ref('')
const sending = ref(false)
const checking = ref(false)
const scope = ref<'user' | 'all'>('user')
const count = computed(() => Array.from(content.value).length)
const draft = ref<{ content: string; scope: 'user' | 'all'; target_user_id: number | null; request_id: string } | null>(
  null,
)
const recipient = ref('')
const sendError = ref('')
const attempted = ref(false)
const records = ref<Awaited<ReturnType<typeof adminApi.getNotificationHistory>>['data']['list']>([])
const page = ref(1)
const total = ref(0)
const historyLoading = ref(false)
const historyError = ref('')
let historyTicket = 0
const userStore = useUserStore()
const storageKey = () => `notification-pending:${userStore.userInfo?.id || userStore.userInfo?.username}`
function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}
onMounted(() => {
  loadHistory()
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey()) || 'null')
    if (saved?.draft?.request_id && saved?.draft?.content) {
      draft.value = saved.draft
      recipient.value = saved.recipient
      attempted.value = true
      sendError.value = '上次发送结果尚未确认，请安全重试获取原结果。'
    }
  } catch {
    /* 存储不可用不影响页面加载 */
  }
})
function closeDraft() {
  if (sending.value) return
  if (attempted.value && !window.confirm('当前发送结果尚未确认。放弃安全重试并重新发送可能重复通知，确认关闭？')) return
  draft.value = null
  try {
    sessionStorage.removeItem(storageKey())
  } catch {
    /* 存储不可用 */
  }
  loadHistory()
}

async function loadHistory() {
  const ticket = ++historyTicket
  historyLoading.value = true
  historyError.value = ''
  try {
    const r = await adminApi.getNotificationHistory({ page: page.value, pageSize: 10 })
    if (ticket === historyTicket) {
      records.value = r.data.list
      total.value = r.data.total
    }
  } catch (e) {
    if (ticket === historyTicket) historyError.value = errorMessage(e, '发送记录加载失败')
  } finally {
    if (ticket === historyTicket) historyLoading.value = false
  }
}
function changePage(value: number) {
  page.value = value
  loadHistory()
}

async function prepare() {
  if (checking.value || sending.value || draft.value) return
  const normalized = content.value.trim()
  if (!normalized || Array.from(normalized).length > 300) return toast('请填写 1～300 字通知内容', 'error')
  const raw = targetUserId.value.trim()
  const target = scope.value === 'user' ? Number(raw) : null
  if (scope.value === 'user' && (!/^\d+$/.test(raw) || !Number.isSafeInteger(target) || Number(target) < 1))
    return toast('请填写有效的用户 ID', 'error')
  checking.value = true
  try {
    const payload = { scope: scope.value, target_user_id: target }
    const r = await adminApi.previewNotification(payload)
    if (!r.data.count) return toast('没有可接收通知的启用用户', 'error')
    recipient.value = r.data.user
      ? `${r.data.user.nickname || r.data.user.username}（@${r.data.user.username}，ID ${r.data.user.id}）`
      : `全部启用用户，预计 ${r.data.count} 人（以实际发送为准）`
    draft.value = { ...payload, content: normalized, request_id: createRequestId() }
    attempted.value = false
    sendError.value = ''
  } catch (e) {
    toast(errorMessage(e, '接收范围校验失败'), 'error')
  } finally {
    checking.value = false
  }
}

async function send() {
  if (sending.value || !draft.value) return
  sending.value = true
  attempted.value = true
  sendError.value = ''
  try {
    sessionStorage.setItem(storageKey(), JSON.stringify({ draft: draft.value, recipient: recipient.value }))
  } catch {
    /* 仍可在当前页面安全重试 */
  }
  try {
    const response = await adminApi.sendNotification(draft.value)
    toast(`批次 #${response.data.id}：已写入 ${response.data.count} 位用户的通知中心`, 'success')
    draft.value = null
    try {
      sessionStorage.removeItem(storageKey())
    } catch {
      /* 存储不可用 */
    }
    content.value = ''
    targetUserId.value = ''
    page.value = 1
    await loadHistory()
  } catch (requestError: unknown) {
    sendError.value = `${errorMessage(requestError, '发送结果未确认')}。重试将使用同一请求编号，不会重复发送。`
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <main class="broadcast-page">
    <header>
      <h2>系统通知</h2>
      <p>向用户的通知中心发送消息，不会触发全站公告弹窗。</p>
    </header>
    <section class="form-card">
      <fieldset :disabled="sending || checking || !!draft">
        <fieldset class="audience">
          <legend>发送给谁</legend>
          <div class="scope-options">
            <label class="scope-option" :class="{ selected: scope === 'user' }">
              <input v-model="scope" type="radio" value="user" name="notification-scope" />
              <span>指定用户</span>
            </label>
            <label class="scope-option" :class="{ selected: scope === 'all' }">
              <input v-model="scope" type="radio" value="all" name="notification-scope" />
              <span>全部启用用户</span>
            </label>
          </div>
        </fieldset>
        <div v-if="scope === 'user'" class="target-row">
          <label for="target-user">目标用户 ID</label>
          <input
            id="target-user"
            v-model="targetUserId"
            inputmode="numeric"
            placeholder="输入用户 ID"
          />
        </div>
        <p v-else class="audience-note">将发送给全部启用账号，请在下一步仔细核对人数。</p>
        <div class="content-heading">
          <label for="notification-content">通知内容</label>
          <span id="content-count" class="muted" :class="{ error: count > 300 }">{{ count }} / 300</span>
        </div>
        <textarea id="notification-content" v-model="content" rows="4" aria-describedby="content-count" :aria-invalid="count > 300" placeholder="写下需要告知用户的内容…"></textarea>
        <div class="compose-footer">
          <span class="muted">确认内容后才会发送</span>
          <button class="primary" :disabled="count > 300 || !content.trim()" @click="prepare">
            {{ checking ? '核对中…' : '预览并确认' }}
          </button>
        </div>
      </fieldset>
    </section>
    <section class="history">
      <div class="history-heading">
        <h3>发送记录</h3>
        <button class="quiet" :disabled="historyLoading" @click="loadHistory">{{ historyLoading ? '刷新中…' : '刷新记录' }}</button>
      </div>
      <p class="history-caption muted">记录实际写入人数，不代表已读人数。</p>
      <div v-if="historyLoading" class="empty-state muted" role="status">正在加载发送记录…</div>
      <div v-else-if="historyError" class="empty-state error" role="alert">{{ historyError }}</div>
      <div v-else-if="!records.length" class="empty-state">
        <strong>还没有发送记录</strong>
        <p class="muted">发送成功后，通知内容与接收人数会显示在这里。</p>
      </div>
      <article v-for="row in historyLoading || historyError ? [] : records" :key="row.id" class="record">
        <div class="footer">
          <strong
            >#{{ row.id }} ·
            {{ row.scope === 'all' ? '全部启用用户' : row.target_label + ' · ID ' + row.target_user_id }}</strong
          ><span class="count-badge">{{ row.recipient_count }} 人</span>
        </div>
        <p class="message">{{ row.content }}</p>
        <small class="muted">{{ row.admin_username }} · {{ formatTime(row.created_at) }}（北京时间）</small>
      </article>
      <AppPagination
        v-if="!historyLoading && !historyError"
        :page="page"
        :page-count="Math.ceil(total / 10)"
        @change="changePage"
      />
    </section>
    <AppModal :open="Boolean(draft)" title="确认系统通知" @close="closeDraft"><template v-if="draft">
      <p class="confirm-recipient"><span class="muted">接收人</span><strong>{{ recipient }}</strong></p>
      <p class="message preview">{{ draft.content }}</p>
      <p class="muted">发送后不可编辑或撤回。请核对接收范围和内容。</p>
      <p v-if="sendError" class="error" role="alert">{{ sendError }}</p>
      <div class="confirm-actions">
        <button :disabled="sending" @click="closeDraft">{{ attempted ? '关闭并查看记录' : '返回修改' }}</button>
        <button class="primary" :disabled="sending" @click="send">
          {{ sending ? '发送中…' : attempted ? '安全重试' : '确认发送' }}
        </button>
      </div>
      <p v-if="attempted && sendError" class="muted">关闭前建议先安全重试确认结果；重新填写并发送会视为新通知。</p>
    </template></AppModal>
  </main>
</template>

<style scoped>
.broadcast-page {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 18px 48px;
  color: var(--text-primary);
}
header h2 {
  margin: 0;
  color: var(--amber);
  font-family: Cinzel, serif;
}
header p {
  margin: 10px 0 24px;
  line-height: 1.7;
  color: var(--text-muted);
  font-size: 0.82rem;
}
.form-card {
  padding: 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
}
label {
  display: block;
  margin: 10px 0 6px;
  color: var(--text-secondary);
  font-size: 0.85rem;
}
input,
textarea,
select {
  width: 100%;
  box-sizing: border-box;
  padding: 10px;
  color: var(--text-primary);
  background: var(--bg-sidebar);
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  font: inherit;
  resize: vertical;
}
input:focus,
textarea:focus {
  outline: none;
  border-color: var(--amber);
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}
.footer span {
  color: var(--text-muted);
  font-size: 0.72rem;
}
button {
  padding: 8px 18px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  cursor: pointer;
  font: inherit;
  font-size: .85rem;
  font-weight: 500;
  min-height: 38px;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.history {
  margin-top: 32px;
}
.history h3 {
  margin: 0;
  font-size: 1rem;
}
.muted {
  color: var(--text-muted);
  font-size: 0.8rem;
  line-height: 1.7;
}
.error,
.footer .error {
  color: var(--red);
}
.record {
  padding: 14px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.record strong {
  font-size: 0.85rem;
}
.footer {
  gap: 12px;
  flex-wrap: wrap;
}
.message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
.preview {
  padding: 12px;
  background: var(--bg-sidebar);
  border-radius: 6px;
}
.primary { background: var(--amber); color: var(--on-amber); border-color: var(--amber); font-weight: 600; }
button:focus-visible, .scope-option:focus-within { outline: 2px solid var(--amber); outline-offset: 3px; }
button:not(:disabled):hover { filter: brightness(1.12); }
.audience legend { padding: 0; margin-bottom: 12px; font-size: .85rem; color: var(--text-secondary); }
.scope-options { display: flex; gap: 10px; }
.scope-option { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; margin: 0; padding: 11px 8px; border: 1px solid var(--border-subtle); border-radius: 7px; cursor: pointer; }
.scope-option.selected { color: var(--amber); border-color: var(--amber); background: var(--amber-glow); }
.scope-option input { width: 14px; height: 14px; margin: 0; padding: 0; accent-color: var(--amber); }
fieldset:disabled .scope-option { cursor: default; }
.target-row { display: grid; grid-template-columns: auto minmax(0,1fr); align-items: center; gap: 14px; margin-top: 16px; }
.target-row label { margin: 0; }
.target-row input { min-width: 0; font-size: .85rem; }
.audience-note { margin: 16px 0 0; min-height: 40px; font-size: .8rem; line-height: 1.7; color: var(--text-secondary); }
.content-heading { display: flex; justify-content: space-between; align-items: center; margin: 22px 0 10px; }
.content-heading label { margin: 0; }
textarea { display: block; min-height: 132px; line-height: 1.7; font-size: .9rem; padding: 12px; }
.compose-footer, .history-heading, .confirm-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.compose-footer { margin-top: 16px; }
.history-caption { margin: 6px 0 16px; }
.quiet { border-color: transparent; padding: 6px 0 6px 12px; min-height: 32px; font-size: .8rem; }
.empty-state { text-align: center; border: 1px dashed var(--border-subtle); border-radius: 10px; padding: 28px 16px; }
.empty-state strong { font-size: .85rem; font-weight: 500; color: var(--text-secondary); }
.empty-state p { margin: 8px 0 0; }
.record .footer { margin-top: 0; align-items: flex-start; }
.record .count-badge { flex-shrink: 0; padding: 3px 8px; background: var(--bg-hover); border-radius: 4px; }
.record strong { flex: 1; min-width: 0; overflow-wrap: anywhere; font-weight: 500; }
.record .message { font-size: .85rem; margin: 10px 0; }
.confirm-recipient { display: flex; flex-direction: column; gap: 6px; overflow-wrap: anywhere; }
.confirm-recipient strong { font-size: .9rem; font-weight: 500; line-height: 1.7; }
.confirm-actions { justify-content: flex-end; margin-top: 24px; flex-wrap: wrap; }
@media (max-width: 380px) {
  .broadcast-page { padding: 20px 12px 36px; }
  .form-card { padding: 16px; }
  .compose-footer { align-items: flex-end; }
  .compose-footer .muted { max-width: 95px; }
  .scope-option { font-size: .8rem; gap: 6px; }
}
</style>
