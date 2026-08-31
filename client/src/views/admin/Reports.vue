<script setup lang="ts">
// 举报管理页（/admin/reports，auth+admin）
// 数据源：GET /admin/reports?page&pageSize&status；处理：PUT /admin/reports/:id/resolve
// 状态流：pending（待处理）→ resolved（举报属实）/ dismissed（举报不属实）
import { ref, onMounted } from 'vue'
import { adminApi } from '../../api'
import { toast } from '../../utils/toast'
import AppPagination from '../../components/AppPagination.vue'
import AppEmpty from '../../components/AppEmpty.vue'
import AppModal from '../../components/AppModal.vue'
import { usePagination } from '../../composables/usePagination'

const list = ref<any[]>([])
const loading = ref(true)
const error = ref('')
const tab = ref<'all' | 'pending' | 'resolved' | 'dismissed'>('pending')
const { page, total, pageCount, pageSize, go, reset } = usePagination(10)

// 处理弹窗
const handleTarget = ref<any>(null)
const handleStatus = ref<'resolved' | 'dismissed'>('resolved')
const handleNote = ref('')

const TABS = [
  { key: 'pending', label: '待处理' },
  { key: 'all', label: '全部' },
  { key: 'resolved', label: '已处理' },
  { key: 'dismissed', label: '已驳回' },
] as const

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params: any = { page: page.value, pageSize }
    if (tab.value !== 'all') params.status = tab.value
    const r: any = await adminApi.getReports(params)
    list.value = r.data.list || []
    total.value = r.data.total || 0
  } catch (e: any) {
    error.value = e?.response?.data?.message || '加载失败，请重试'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function switchTab(t: typeof tab.value) {
  if (t === tab.value) return
  tab.value = t
  reset()
  load()
}

function goPage(p: number) {
  if (go(p)) load()
}

/** 解析 reason 的 "[类型] 内容" 前缀（D21 格式：举报类型以 [类型] 前缀并入 reason） */
function parseReason(reason: string) {
  const m = reason?.match(/^\[(.*?)\]\s*([\s\S]*)$/)
  return m ? { type: m[1], text: m[2] || '(未填写具体说明)' } : { type: '', text: reason || '' }
}

const TARGET_NAMES: Record<string, string> = { post: '文章', user: '用户', comment: '评论' }
const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'st-pending' },
  resolved: { label: '已处理', cls: 'st-resolved' },
  dismissed: { label: '已驳回', cls: 'st-dismissed' },
}

/** 是否有可跳转的目标页（comment 举报后端未存 post_id，无法定位文章 → 不可跳转） */
function canJump(r: any): boolean {
  return r.target_type === 'post' || r.target_type === 'user'
}

function targetUrl(r: any): string {
  if (r.target_type === 'user') return `/user/${r.target_id}`
  if (r.target_type === 'post') return `/post/${r.target_id}`
  // comment：后端 reports 只存评论 id（未存所属文章 post_id），前端无法定位文章 → 不提供跳转
  // （原实现 comment 也跳 /post/:id，会落到评论 id 上必然 404）；此返回值仅在 canJump=true 时被消费
  return '/'
}

function openHandle(r: any) {
  handleTarget.value = r
  handleStatus.value = 'resolved'
  handleNote.value = ''
}

async function confirmHandle() {
  if (!handleTarget.value) return
  try {
    await adminApi.resolveReport(handleTarget.value.id, {
      status: handleStatus.value,
      handler_note: handleNote.value.trim(),
    })
    toast(handleStatus.value === 'resolved' ? '已标记处理' : '已驳回举报', 'success')
    handleTarget.value = null
    load() // 刷新当前 tab（全部 tab 下状态标签同步更新）
  } catch (e: any) {
    toast(e?.response?.data?.message || '操作失败，请重试', 'error')
  }
}
</script>

<template>
  <div style="max-width: 900px; margin: 0 auto; padding: 20px 16px 40px; color: var(--text-primary)">
    <!-- 头部 -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px">
      <div style="display: flex; align-items: center; gap: 10px">
        <h2 style="font-family: Cinzel, serif; color: var(--amber)">举报管理</h2>
        <span v-if="!loading" class="badge">{{ total }} 条</span>
      </div>
      <button class="refresh-btn" @click="load">↻ 刷新</button>
    </div>

    <!-- Tab 筛选 -->
    <div style="display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="tab-btn"
        :class="{ active: tab === t.key }"
        @click="switchTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 加载/错误/空态（AppEmpty 统一三件套） -->
    <AppEmpty :loading="loading" :error="error" empty-text="暂无举报" icon="🛡️" @retry="load" />

    <!-- 举报列表 -->
    <template v-if="!loading && !error && list.length">
      <div v-for="r in list" :key="r.id" class="report-card">
        <div style="display: flex; align-items: flex-start; gap: 10px">
          <span class="st-tag" :class="STATUS_META[r.status]?.cls">{{ STATUS_META[r.status]?.label }}</span>
          <div style="flex: 1; min-width: 0">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
              <span v-if="parseReason(r.reason).type" class="type-tag">{{ parseReason(r.reason).type }}</span>
              <span style="font-size: 0.8rem; color: var(--text-secondary)">
                {{ TARGET_NAMES[r.target_type] || r.target_type }} #{{ r.target_id }}
              </span>
              <router-link v-if="canJump(r)" :to="targetUrl(r)" class="view-link">查看原文 ›</router-link>
            </div>
            <div class="reason-text">{{ parseReason(r.reason).text }}</div>
            <div class="report-meta">
              <span>举报人 #{{ r.reporter_id }}</span>
              <span>🕐 {{ r.created_at?.slice(0, 16) }}</span>
              <template v-if="r.status !== 'pending'">
                <span>处理人 #{{ r.handler_id || '-' }}</span>
                <span v-if="r.handler_note">备注：{{ r.handler_note }}</span>
              </template>
            </div>
          </div>
          <button v-if="r.status === 'pending'" class="action-btn" @click="openHandle(r)">处理</button>
        </div>
      </div>

      <!-- 分页（AppPagination 统一控件） -->
      <AppPagination :page="page" :page-count="pageCount" @change="goPage" />
    </template>

    <!-- 处理弹窗（AppModal 统一弹窗） -->
    <AppModal v-if="handleTarget" title="处理举报" @close="handleTarget = null">
      <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.6">
        {{ TARGET_NAMES[handleTarget.target_type] || handleTarget.target_type }} #{{ handleTarget.target_id }}
        <span v-if="parseReason(handleTarget.reason).type" class="type-tag" style="margin-left: 6px">{{
          parseReason(handleTarget.reason).type
        }}</span
        ><br />
        <span style="color: var(--text-primary)">{{ parseReason(handleTarget.reason).text }}</span>
      </div>
      <div style="display: flex; gap: 10px; margin-bottom: 12px">
        <label class="verdict" :class="{ selected: handleStatus === 'resolved' }">
          <input v-model="handleStatus" type="radio" value="resolved" hidden />
          <span>✅ 举报属实</span>
        </label>
        <label class="verdict" :class="{ selected: handleStatus === 'dismissed' }">
          <input v-model="handleStatus" type="radio" value="dismissed" hidden />
          <span>❌ 举报不属实</span>
        </label>
      </div>
      <textarea
        v-model="handleNote"
        class="note-input"
        rows="2"
        maxlength="300"
        placeholder="处理备注（选填，≤300 字，如已下架处理等）"
      ></textarea>
      <div style="display: flex; gap: 8px; margin-top: 12px">
        <button class="modal-btn" @click="handleTarget = null">取消</button>
        <button class="modal-btn primary" @click="confirmHandle">确认处理</button>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.badge {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--amber-glow);
  color: var(--amber);
}
.refresh-btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.78rem;
  cursor: pointer;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-family: inherit;
  transition: all var(--transition-fast);
}
.refresh-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.tab-btn {
  padding: 7px 18px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}
.tab-btn:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}
.tab-btn.active {
  background: var(--amber);
  color: var(--on-amber);
  border-color: var(--amber);
  font-weight: 600;
}

.report-card {
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  margin-bottom: 8px;
}
.st-tag {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  margin-top: 2px;
}
.st-pending {
  background: var(--amber-glow);
  color: var(--amber);
}
.st-resolved {
  background: rgba(124, 184, 124, 0.15);
  color: var(--green);
}
.st-dismissed {
  background: var(--border-subtle);
  color: var(--text-muted);
}
.type-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}
.view-link {
  font-size: 0.72rem;
  color: var(--amber);
  text-decoration: none;
}
.view-link:hover {
  text-decoration: underline;
}
.reason-text {
  margin-top: 6px;
  font-size: 0.85rem;
  color: var(--text-primary);
  line-height: 1.6;
  word-break: break-word;
}
.report-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 8px;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.action-btn {
  flex-shrink: 0;
  padding: 6px 18px;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  font-family: inherit;
  background: var(--amber);
  color: var(--on-amber);
  font-weight: 600;
  transition: opacity var(--transition-fast);
}
.action-btn:hover {
  opacity: 0.85;
}

.verdict {
  flex: 1;
  padding: 9px 0;
  text-align: center;
  border-radius: 8px;
  cursor: pointer;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 500;
  transition: all var(--transition-fast);
}
.verdict:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}
.verdict.selected {
  background: var(--amber-glow);
  border-color: var(--amber);
  color: var(--amber);
}
.note-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  background: var(--bg-sidebar);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.82rem;
  font-family: inherit;
  resize: vertical;
  outline: none;
}
.note-input:focus {
  border-color: var(--amber);
}
.modal-btn {
  flex: 1;
  padding: 7px 0;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-family: inherit;
  transition: all var(--transition-fast);
}
.modal-btn:hover {
  color: var(--text-primary);
}
.modal-btn.primary {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--on-amber);
  font-weight: 600;
}
.modal-btn.primary:hover {
  background: var(--amber-dim);
  color: var(--on-amber);
}
</style>
