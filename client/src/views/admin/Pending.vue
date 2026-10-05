<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, inject } from 'vue'
import { pageBackKey } from '../../composables/pageBack'
import { isAxiosError } from 'axios'
import { adminApi } from '../../api'
import { toast } from '../../utils/toast'
import { errorMessage } from '../../utils/errors'
import AppPagination from '../../components/AppPagination.vue'
import AppEmpty from '../../components/AppEmpty.vue'
import AppModal from '../../components/AppModal.vue'
import PostBody from '../../components/PostBody.vue'
import { usePagination } from '../../composables/usePagination'
import type { Post, ReviewPost } from '../../types/api'

const list = ref<Post[]>([])
const pageBack = inject(pageBackKey)
function handlePageBack() {
  if (busy.value) return true
  if (rejectOpen.value) {
    closeReject()
    return true
  }
  if (selectedId.value !== null) {
    back()
    return true
  }
  return false
}
const loading = ref(true)
const error = ref('')
const { page, total, pageCount, pageSize, go } = usePagination(10)
const selectedId = ref<number | null>(null)
const detail = ref<ReviewPost | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const decisionError = ref('')
const stale = ref(false)
const busy = ref(false)
const rejectOpen = ref(false)
const rejectReason = ref('')
let listSeq = 0
let detailSeq = 0

async function load() {
  const seq = ++listSeq
  loading.value = true
  error.value = ''
  try {
    const r = await adminApi.getPendingPosts({ page: page.value, pageSize })
    if (seq !== listSeq) return
    list.value = r.data.list
    total.value = r.data.total
    const last = Math.max(1, Math.ceil(total.value / pageSize))
    if (page.value > last) {
      page.value = last
      await load()
    }
  } catch (e) {
    if (seq === listSeq) error.value = errorMessage(e, '加载失败，请重试')
  } finally {
    if (seq === listSeq) loading.value = false
  }
}
async function openReview(id: number) {
  if (busy.value) return
  selectedId.value = id
  detail.value = null
  detailError.value = ''
  decisionError.value = ''
  stale.value = false
  rejectOpen.value = false
  detailLoading.value = true
  const seq = ++detailSeq
  try {
    const r = await adminApi.getReviewDetail(id)
    if (seq === detailSeq) detail.value = r.data
  } catch (e) {
    if (seq === detailSeq) detailError.value = errorMessage(e, '审阅详情加载失败')
  } finally {
    if (seq === detailSeq) detailLoading.value = false
  }
}
function back() {
  if (busy.value) return
  detailSeq++
  selectedId.value = null
  detail.value = null
  rejectOpen.value = false
  void load()
}
function goPage(p: number) {
  if (go(p)) void load()
}
function openReject() {
  if (busy.value || stale.value) return
  rejectReason.value = ''
  rejectOpen.value = true
}
function closeReject() {
  if (!busy.value) rejectOpen.value = false
}
async function decide(approve: boolean) {
  const post = detail.value
  if (!post || busy.value || stale.value || post.status !== 'pending') return
  const reason = rejectReason.value.trim()
  if (!approve && (!reason || reason.length > 200)) return toast('请填写 1 至 200 字驳回原因', 'error')
  busy.value = true
  decisionError.value = ''
  try {
    if (approve) await adminApi.approvePost(post.id, post.content_version)
    else await adminApi.rejectPost(post.id, reason, post.content_version)
    toast(approve ? '已通过并发布，作者已收到通知' : '已驳回，作者已收到通知', 'success')
    rejectOpen.value = false
    selectedId.value = null
    detail.value = null
    await load()
  } catch (e) {
    decisionError.value = errorMessage(e, '审核失败，请重试')
    if (isAxiosError(e) && [404, 409].includes(e.response?.status || 0)) {
      stale.value = true
      rejectOpen.value = false
      void load()
    }
  } finally {
    busy.value = false
  }
}
function displayTime(value?: string | null) {
  return value
    ? value
        .replace('T', ' ')
        .replace(/\.\d+Z$/, '')
        .slice(0, 19)
    : '历史记录，提交时间未记录'
}
onMounted(() => {
  if (pageBack) pageBack.value = handlePageBack
  void load()
})
onBeforeUnmount(() => {
  if (pageBack?.value === handlePageBack) pageBack.value = null
  listSeq++
  detailSeq++
})
</script>

<template>
  <main class="review-page">
    <header class="heading">
      <div>
        <h2>内容审核</h2>
        <p v-if="selectedId === null">{{ total }} 篇待审 · 按提交时间排序</p>
      </div>
      <button v-if="selectedId === null" :disabled="loading" @click="load">刷新</button>
    </header>

    <template v-if="selectedId === null">
      <AppEmpty
        v-if="loading || error || !list.length"
        :loading="loading"
        :error="error"
        empty-text="暂无待审核文章"
        @retry="load"
      />
      <template v-else>
        <article v-for="post in list" :key="post.id" class="queue-card">
          <div class="queue-info">
            <h3>{{ post.title }}</h3>
            <p>{{ post.username }} · {{ post.game_name }} · {{ post.category }}<span v-if="post.is_revision"> · 修订审核</span></p>
            <p>提交：{{ displayTime(post.submitted_at) }}</p>
          </div>
          <button class="primary" @click="openReview(post.id)">审阅</button>
        </article>
        <AppPagination :page="page" :page-count="pageCount" @change="goPage" />
      </template>
    </template>
    <template v-else>
      <AppEmpty
        v-if="detailLoading || detailError"
        :loading="detailLoading"
        :error="detailError"
        @retry="openReview(selectedId!)"
      />
      <article v-else-if="detail" class="detail-card">
        <header>
          <h3 class="title">{{ detail.title }}</h3>
          <p>{{ detail.username }} · {{ detail.game_name }} · {{ detail.category }}</p>
          <p>提交：{{ displayTime(detail.submitted_at) }}</p>
          <p v-if="detail.tags.length">标签：{{ detail.tags.join(' · ') }}</p>
        </header>
        <p v-if="detail.is_revision" class="notice">当前审阅的是修订版，原文章仍公开；通过后替换，驳回不影响原文章。</p>
        <p v-if="detail.status !== 'pending'" class="notice">该文章已不在待审状态，请返回列表查看其他文章。</p>
        <section v-if="detail.cover" class="cover-section" aria-label="文章封面">
          <p>封面</p>
          <img :src="detail.cover" alt="文章封面" class="cover" />
        </section>
        <PostBody :post="detail" />
        <details v-if="detail.reviews.length" class="history">
          <summary>最近审核记录（最多 20 条）</summary>
          <article v-for="review in detail.reviews" :key="review.id">
            <p>
              {{ review.decision === 'published' ? '通过' : '驳回' }} · {{ review.reviewer_username }} ·
              {{ displayTime(review.created_at) }}
            </p>
            <p v-if="review.reason">{{ review.reason }}</p>
          </article>
        </details>
        <p v-if="decisionError" class="notice" role="alert">{{ decisionError }}</p>
        <div v-if="stale" class="actions">
          <button :disabled="busy" @click="openReview(selectedId!)">重新加载并审阅</button>
        </div>
        <footer v-else-if="detail.status === 'pending'" class="actions">
          <button class="danger" :disabled="busy" @click="openReject">驳回</button>
          <button class="primary" :disabled="busy" @click="decide(true)">{{ busy ? '处理中…' : '通过并发布' }}</button>
        </footer>
      </article>
    </template>

    <AppModal :open="Boolean(rejectOpen && detail)" title="驳回文章" @close="closeReject"><template v-if="rejectOpen && detail">
      <p>《{{ detail.title }}》</p>
      <p class="modal-hint">请说明需要修改的地方，作者会收到此原因。</p>
      <label for="reject-reason">驳回原因</label>
      <textarea
        id="reject-reason"
        v-model="rejectReason"
        :disabled="busy"
        maxlength="200"
        rows="4"
        placeholder="例如：关键打法缺少说明，请补充操作步骤。"
      />
      <p class="modal-hint">{{ rejectReason.length }}/200</p>
      <p v-if="decisionError" class="notice" role="alert">{{ decisionError }}</p>
      <div class="actions">
        <button :disabled="busy" @click="closeReject">取消</button>
        <button class="danger" :disabled="busy || !rejectReason.trim()" @click="decide(false)">
          {{ busy ? '处理中…' : '确认驳回' }}
        </button>
      </div>
    </template></AppModal>
  </main>
</template>

<style scoped>
.review-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 16px 40px;
  color: var(--text-primary);
}
.heading,
.queue-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.heading {
  margin-bottom: 20px;
}
h2,
h3,
p {
  margin: 0;
}
h2 {
  font-size: 1.2rem;
  color: var(--amber);
}
h3 {
  font-size: 0.95rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
p {
  line-height: 1.7;
}
.heading p,
.queue-info p,
.detail-card header p,
.cover-section p,
.modal-hint {
  color: var(--text-muted);
  font-size: 0.78rem;
  margin-top: 5px;
}
.queue-card,
.detail-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 18px;
  margin-bottom: 12px;
}
.queue-info {
  min-width: 0;
}
button {
  font: inherit;
  font-size: 0.8rem;
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  padding: 8px 14px;
  color: var(--text-secondary);
  background: var(--bg-hover);
  cursor: pointer;
  flex-shrink: 0;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 3px;
}
.primary {
  background: var(--amber);
  color: var(--on-amber);
}
.danger {
  border-color: var(--red);
  color: var(--red);
}
.title {
  font-size: 1.2rem;
}
.detail-card header {
  margin-bottom: 22px;
}
.cover-section {
  margin-bottom: 18px;
}
.cover {
  display: block;
  max-width: 100%;
  max-height: 320px;
  margin-top: 8px;
  object-fit: contain;
}
.actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
}
.detail-card > .actions {
  border-top: 1px solid var(--border-subtle);
  padding-top: 16px;
}
.notice {
  margin-top: 16px;
  padding: 10px;
  color: var(--amber);
  background: var(--amber-glow);
  border-radius: 7px;
  font-size: 0.82rem;
}
.history {
  margin-top: 24px;
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.history summary {
  cursor: pointer;
}
.history article {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
}
textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  font: inherit;
  padding: 10px;
  resize: vertical;
  margin-top: 8px;
}
label {
  display: block;
  margin-top: 14px;
  font-size: 0.82rem;
}
@media (max-width: 600px) {
  .detail-card {
    padding: 14px 12px;
  }
  .queue-card {
    align-items: flex-start;
  }
}
</style>
