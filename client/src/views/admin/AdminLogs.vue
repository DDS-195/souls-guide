<script setup lang="ts">
// 日志管理页（/admin/logs，auth+admin）——D23 操作日志（2026-08-09）
// 数据源：GET /admin/logs?page&pageSize&action&keyword&start&end；记录由后端中间件自动落库（3.14 operation_logs）
import { ref, onMounted } from 'vue'
import { adminApi } from '../../api'
import AppPagination from '../../components/AppPagination.vue'
import AppEmpty from '../../components/AppEmpty.vue'
import { usePagination } from '../../composables/usePagination'

const list = ref<any[]>([])
const loading = ref(true)
const error = ref('')
const { page, total, pageCount, pageSize, go, reset } = usePagination(10)

// 筛选（契约：admin_id/action/keyword/start/end 均可选，时间范围前端 date input 传）
const action = ref('')
const keyword = ref('')
const start = ref('')
const end = ref('')

// action 枚举共 17 种（3.14 注释），中文标签直接做筛选下拉
const ACTIONS: [string, string][] = [
  ['approve_post', '通过文章'],
  ['reject_post', '驳回文章'],
  ['approve_application', '通过申请'],
  ['reject_application', '驳回申请'],
  ['resolve_report', '处理举报'],
  ['ban_user', '封禁用户'],
  ['delete_user', '删除用户'],
  ['create_announcement', '创建公告'],
  ['update_announcement', '更新公告'],
  ['publish_announcement', '发布公告'],
  ['archive_announcement', '归档公告'],
  ['delete_announcement', '删除公告'],
  ['send_notification', '发送通知'],
  ['create_game', '创建游戏'],
  ['update_game', '更新游戏'],
  ['delete_game', '删除游戏'],
  ['sort_games', '排序游戏'],
]
const ACTION_META: Record<string, string> = Object.fromEntries(ACTIONS)
const METHOD_CLS: Record<string, string> = { POST: 'm-post', PUT: 'm-put', DELETE: 'm-del' }

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params: any = { page: page.value, pageSize }
    if (action.value) params.action = action.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    if (start.value) params.start = start.value
    if (end.value) params.end = end.value
    const r: any = await adminApi.getLogs(params)
    list.value = r.data.list || []
    total.value = r.data.total || 0
  } catch (e: any) {
    error.value = e?.response?.data?.message || '加载失败，请重试'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function applyFilter() {
  reset()
  load()
}

function resetFilter() {
  action.value = ''
  keyword.value = ''
  start.value = ''
  end.value = ''
  reset()
  load()
}

function goPage(p: number) {
  if (go(p)) load()
}
</script>

<template>
  <div style="max-width: 900px; margin: 0 auto; padding: 20px 16px 40px; color: var(--text-primary)">
    <!-- 头部 -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px">
      <div style="display: flex; align-items: center; gap: 10px">
        <h2 style="font-family: Cinzel, serif; color: var(--amber)">日志管理</h2>
        <span v-if="!loading" class="badge">{{ total }} 条</span>
      </div>
      <button class="refresh-btn" @click="load">↻ 刷新</button>
    </div>

    <!-- 筛选区 -->
    <div class="filter-bar">
      <select v-model="action" class="f-input">
        <option value="">全部操作</option>
        <option v-for="[val, label] in ACTIONS" :key="val" :value="val">{{ label }}</option>
      </select>
      <input v-model="keyword" class="f-input" placeholder="描述关键词" @keyup.enter="applyFilter" />
      <input v-model="start" type="date" class="f-input" title="开始日期" />
      <span class="f-sep">—</span>
      <input v-model="end" type="date" class="f-input" title="结束日期" />
      <button class="f-btn primary" @click="applyFilter">查询</button>
      <button class="f-btn" @click="resetFilter">重置</button>
    </div>

    <!-- 加载/错误/空态（AppEmpty 统一三件套） -->
    <AppEmpty :loading="loading" :error="error" empty-text="暂无操作日志" icon="📜" @retry="load" />

    <!-- 日志列表 -->
    <template v-if="!loading && !error && list.length">
      <div v-for="r in list" :key="r.id" class="log-card">
        <div style="display: flex; align-items: flex-start; gap: 10px">
          <div style="flex: 1; min-width: 0">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
              <span class="act-tag">{{ ACTION_META[r.action] || r.action }}</span>
              <span class="m-tag" :class="METHOD_CLS[r.method]">{{ r.method }}</span>
              <span class="st-ok">{{ r.status }}</span>
              <span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 500">{{
                r.admin_username
              }}</span>
              <span v-if="r.target_type" class="type-tag">{{ r.target_type }} #{{ r.target_id ?? '-' }}</span>
            </div>
            <div class="detail-text">{{ r.detail || '—' }}</div>
            <div class="path-text">{{ r.path }}</div>
            <div class="log-meta">
              <span>🌐 {{ r.ip || '-' }}</span>
              <span>🕐 {{ r.created_at?.slice(0, 19).replace('T', ' ') }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 分页（AppPagination 统一控件） -->
      <AppPagination :page="page" :page-count="pageCount" @change="goPage" />
    </template>
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

.filter-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  align-items: center;
}
.f-input {
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-family: inherit;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  outline: none;
}
.f-input:focus {
  border-color: var(--amber);
}
select.f-input {
  cursor: pointer;
}
input.f-input[type='date'] {
  color-scheme: dark;
}
.f-sep {
  color: var(--text-muted);
  font-size: 0.8rem;
}
.f-btn {
  padding: 7px 16px;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-family: inherit;
  transition: all var(--transition-fast);
}
.f-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}
.f-btn.primary {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--on-amber);
  font-weight: 600;
}
.f-btn.primary:hover {
  background: var(--amber-dim);
}

.log-card {
  padding: 12px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  margin-bottom: 8px;
}
.act-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.68rem;
  font-weight: 600;
  background: var(--amber-glow);
  color: var(--amber);
}
.m-tag {
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--on-amber);
}
.m-post {
  background: rgba(124, 184, 124, 0.6);
}
.m-put {
  background: rgba(232, 168, 56, 0.6);
}
.m-del {
  background: rgba(196, 96, 96, 0.7);
}
.st-ok {
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 0.62rem;
  font-weight: 600;
  background: rgba(124, 184, 124, 0.15);
  color: var(--green);
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
.detail-text {
  margin-top: 6px;
  font-size: 0.85rem;
  color: var(--text-primary);
  line-height: 1.6;
  word-break: break-word;
}
.path-text {
  margin-top: 2px;
  font-size: 0.72rem;
  color: var(--text-muted);
  font-family: 'Consolas', monospace;
  word-break: break-all;
}
.log-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 8px;
  font-size: 0.72rem;
  color: var(--text-muted);
}
</style>
