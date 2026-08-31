<script setup lang="ts">
// 内容审核页（/admin/pending，auth+admin）
// 数据源：GET /admin/posts/pending（分页，返回 posts.* + username，含正文 content）
// 待审文章详情页不公开（详情仅 published 开放），管理员在列表内直接预览正文后 通过/驳回
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
const expanded = ref<Set<number>>(new Set())
const { page, total, pageCount, pageSize, go } = usePagination(10)

// 驳回弹窗
const rejectTarget = ref<any>(null)
const rejectReason = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r: any = await adminApi.getPendingPosts({ page: page.value, pageSize })
    list.value = r.data.list || []
    total.value = r.data.total || 0
  } catch (e: any) {
    error.value = e?.response?.data?.message || '加载失败，请重试'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function goPage(p: number) {
  if (go(p)) load()
}

/** 通过：成功 toast 后从列表移除；当前页清空则回退一页 */
async function approve(p: any) {
  try {
    await adminApi.approvePost(p.id)
    toast(`已通过《${p.title}》，作者将收到站内通知`, 'success')
    removeAndBack(p.id)
  } catch (e: any) {
    toast(e?.response?.data?.message || '操作失败，请重试', 'error')
  }
}

function openReject(p: any) {
  rejectTarget.value = p
  rejectReason.value = ''
}

async function confirmReject() {
  if (!rejectTarget.value) return
  if (!rejectReason.value.trim()) return toast('请填写驳回原因', 'error')
  try {
    const id = rejectTarget.value.id
    const title = rejectTarget.value.title
    await adminApi.rejectPost(id, rejectReason.value.trim())
    rejectTarget.value = null
    toast(`已驳回《${title}》`, 'success')
    removeAndBack(id)
  } catch (e: any) {
    toast(e?.response?.data?.message || '操作失败，请重试', 'error')
  }
}

function removeAndBack(id: number) {
  list.value = list.value.filter((p: any) => p.id !== id)
  total.value = Math.max(0, total.value - 1)
  if (!list.value.length && page.value > 1) {
    page.value -= 1
    load()
  }
}

/** D22：content 为富文本 HTML → 纯文本预览（img 占位 + 去标签，textContent 天然无标签） */
function htmlToText(s: string) {
  const div = document.createElement('div')
  div.innerHTML = s.replace(/<img[^>]*>/gi, '【图片】')
  return (div.textContent || '').replace(/\s+/g, ' ').trim()
}

function previewOf(p: any) {
  const text = htmlToText(p.content || '')
  if (expanded.value.has(p.id)) return text
  return text.length > 160 ? text.slice(0, 160) + '…' : text
}

function toggleExpand(p: any) {
  const s = new Set(expanded.value)
  if (s.has(p.id)) s.delete(p.id)
  else s.add(p.id)
  expanded.value = s
}
</script>

<template>
  <div style="max-width: 900px; margin: 0 auto; padding: 20px 16px 40px; color: var(--text-primary)">
    <!-- 头部 -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
      <div style="display: flex; align-items: center; gap: 10px">
        <h2 style="font-family: Cinzel, serif; color: var(--amber)">内容审核</h2>
        <span v-if="!loading" class="badge">{{ total }} 篇待审</span>
      </div>
      <button class="refresh-btn" @click="load">↻ 刷新</button>
    </div>

    <!-- 加载/错误/空态（AppEmpty 统一三件套） -->
    <AppEmpty :loading="loading" :error="error" empty-text="暂无待审核文章" icon="🗡️" @retry="load" />

    <!-- 文章列表 -->
    <template v-if="!loading && !error && list.length">
      <div v-for="p in list" :key="p.id" class="post-card">
        <div style="display: flex; align-items: flex-start; gap: 10px">
          <span class="tag-pending">待审核</span>
          <div style="flex: 1; min-width: 0">
            <div class="post-title">{{ p.title }}</div>
            <div class="post-meta">
              <span>✍ {{ p.username }}</span>
              <span>{{ p.game_name || '游戏 #' + p.game_id }}</span>
              <span v-if="p.category">{{ p.category }}</span>
              <span>🕐 {{ p.created_at?.slice(0, 10) }}</span>
              <span>👁 {{ p.view_count }} · 👍 {{ p.like_count }} · 💬 {{ p.comment_count }}</span>
            </div>
          </div>
        </div>
        <!-- 正文预览（pending 详情页不公开，管理员直接在此审阅） -->
        <div class="post-preview">
          <span v-if="!previewOf(p)" style="color: var(--text-muted)">（无正文内容）</span>
          <template v-else>{{ previewOf(p) }}</template>
          <span v-if="htmlToText(p.content || '').length > 160" class="expand-link" @click="toggleExpand(p)">
            {{ expanded.has(p.id) ? '收起' : '展开全文' }}
          </span>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px">
          <button class="action-btn danger" @click="openReject(p)">驳回</button>
          <button class="action-btn primary" @click="approve(p)">✓ 通过并发布</button>
        </div>
      </div>

      <!-- 分页（AppPagination 统一控件） -->
      <AppPagination :page="page" :page-count="pageCount" @change="goPage" />
    </template>

    <!-- 驳回弹窗（AppModal 统一弹窗） -->
    <AppModal v-if="rejectTarget" title="驳回文章" @close="rejectTarget = null">
      <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px">
        《{{ rejectTarget.title }}》<br />
        <span style="font-size: 0.75rem; color: var(--text-muted)">驳回后作者将收到站内通知，需修改后重新提交审核</span>
      </div>
      <textarea
        v-model="rejectReason"
        class="reason-input"
        rows="3"
        maxlength="200"
        placeholder="请填写驳回原因（必填，≤200 字）"
      ></textarea>
      <div style="display: flex; gap: 8px; margin-top: 12px">
        <button class="modal-btn" @click="rejectTarget = null">取消</button>
        <button class="modal-btn primary" @click="confirmReject">确认驳回</button>
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

.post-card {
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  margin-bottom: 8px;
}
.tag-pending {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.65rem;
  font-weight: 600;
  margin-top: 2px;
  background: var(--amber-glow);
  color: var(--amber);
}
.post-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
}
.post-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
  font-size: 0.72rem;
  color: var(--text-muted);
}
.post-preview {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--bg-sidebar);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.expand-link {
  color: var(--amber);
  cursor: pointer;
  margin-left: 6px;
  white-space: nowrap;
}
.expand-link:hover {
  text-decoration: underline;
}

.action-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  font-family: inherit;
  transition: opacity var(--transition-fast);
}
.action-btn:hover {
  opacity: 0.85;
}
.action-btn.primary {
  background: var(--green);
  color: #fff;
  font-weight: 600;
}
.action-btn.danger {
  background: var(--red);
  color: #fff;
}

.reason-input {
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
.reason-input:focus {
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
