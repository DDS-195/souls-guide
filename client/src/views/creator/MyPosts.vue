<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { postApi } from '../../api'
import AppPagination from '../../components/AppPagination.vue'
import AppEmpty from '../../components/AppEmpty.vue'
import { usePagination } from '../../composables/usePagination'
import { useLatestRequest } from '../../composables/useLatestRequest'
import type { MyPost, PostStatus } from '../../types/api'
import { errorMessage } from '../../utils/errors'

const router = useRouter()
const posts = ref<MyPost[]>([])
const submittingId = ref<number | null>(null)
const msg = ref('')
const loading = ref(true)
const loadError = ref('')

const { page, total, pageCount, pageSize, go } = usePagination(10)
const { next, isLatest } = useLatestRequest()
const statusMap: Record<PostStatus, string> = { draft: '草稿', pending: '审核中', published: '已发布', rejected: '已驳回' }
const statusColor: Record<PostStatus, string> = {
  draft: 'var(--text-muted)',
  pending: 'var(--amber)',
  published: 'var(--green)',
  rejected: 'var(--red)',
}

onMounted(load)

async function load() {
  const sequence = next()
  loading.value = true
  loadError.value = ''
  try {
    // 4.1 契约 GET /posts/my/list：本人全部状态文章（含 reject_reason），详情仅 published 公开
    const res = await postApi.getMyList({ page: page.value, pageSize })
    if (!isLatest(sequence)) return
    posts.value = res.data.list || []
    total.value = res.data.total
    if (page.value > pageCount.value) {
      page.value = pageCount.value
      return load()
    }
  } catch {
    if (isLatest(sequence)) loadError.value = '加载失败，请重试'
  } finally {
    if (isLatest(sequence)) loading.value = false
  }
}

/** 草稿/被驳回的文章重新提交审核（POST /posts/:id/submit，draft/rejected → pending） */
async function resubmit(p: MyPost) {
  submittingId.value = p.id
  try {
    await postApi.submit(p.id)
    p.status = 'pending'
    msg.value = '已提交审核'
  } catch (error: unknown) {
    msg.value = errorMessage(error, '提交失败')
  } finally {
    submittingId.value = null
  }
}

function goPage(nextPage: number) {
  if (go(nextPage)) load()
}
</script>

<template>
  <div style="max-width: 900px; margin: 0 auto; padding: 20px; color: var(--text-primary)">
    <h2 style="font-family: Cinzel, serif; color: var(--amber); margin-bottom: 20px">我的作品</h2>
    <p v-if="msg" style="text-align: center; color: var(--green); font-size: 0.82rem; margin-bottom: 10px">{{ msg }}</p>
    <AppEmpty v-if="loading || loadError || !posts.length" :loading="loading" :error="loadError" empty-text="还没有作品" @retry="load" />
    <div v-else style="display: flex; flex-direction: column; gap: 8px">
      <div
        v-for="p in posts"
        :key="p.id"
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          gap: 12px;
        "
      >
        <div style="min-width: 0">
          <div style="font-weight: 600">{{ p.title }}</div>
          <div
            style="
              font-size: 0.75rem;
              color: var(--text-muted);
              margin-top: 4px;
              display: flex;
              gap: 10px;
              flex-wrap: wrap;
            "
          >
            <span :style="{ color: statusColor[p.status] }">{{ p.is_revision ? '修订' : '' }}{{ statusMap[p.status] || p.status }}</span>
            <span v-if="p.public_status === 'published'">原文章公开中</span>
            <span>{{ p.view_count }} 阅读 · {{ p.created_at?.slice(0, 10) }}</span>
            <span v-if="p.status === 'rejected' && p.reject_reason" style="color: var(--red)"
              >驳回原因：{{ p.reject_reason }}</span
            >
          </div>
        </div>
        <div style="display: flex; gap: 8px; flex-shrink: 0">
          <button
            v-if="p.status === 'published' || p.public_status === 'published'"
            style="
              padding: 6px 12px;
              background: var(--bg-card);
              border: 1px solid var(--border-subtle);
              border-radius: 6px;
              color: var(--text-secondary);
              cursor: pointer;
              font-size: 0.8rem;
            "
            @click="router.push(`/post/${p.id}`)"
          >
            查看
          </button>
          <button
            v-if="p.status === 'draft' || p.status === 'rejected'"
            :disabled="submittingId === p.id"
            class="resubmit-btn"
            @click="resubmit(p)"
          >
            {{ submittingId === p.id ? '提交中...' : '提交审核' }}
          </button>
          <button
            style="
              padding: 6px 12px;
              background: var(--bg-card);
              border: 1px solid var(--border-subtle);
              border-radius: 6px;
              color: var(--text-secondary);
              cursor: pointer;
              font-size: 0.8rem;
            "
            @click="router.push(`/creator/write/${p.id}`)"
          >
            编辑
          </button>
        </div>
      </div>
    </div>
    <AppPagination v-if="!loading && !loadError" :page="page" :page-count="pageCount" @change="goPage" />
  </div>
</template>

<style scoped>
/* 重新提交审核按钮（2026-08-16 样式统一：原内联 rgba(232,168,56,...) 迁移至此） */
.resubmit-btn {
  padding: 6px 12px;
  background: rgba(232, 168, 56, 0.1);
  border: 1px solid rgba(232, 168, 56, 0.3);
  border-radius: 6px;
  color: var(--amber);
  cursor: pointer;
  font-size: 0.8rem;
  transition: background var(--transition-fast);
}
.resubmit-btn:hover:not(:disabled) {
  background: rgba(232, 168, 56, 0.25);
}
.resubmit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
