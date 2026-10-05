<script setup lang="ts">
import { ref } from 'vue'
import { postApi } from '../api'
import PostCard from '../components/PostCard.vue'
import { useLatestRequest } from '../composables/useLatestRequest'
import { usePagination } from '../composables/usePagination'
import AppPagination from '../components/AppPagination.vue'
import type { Post } from '../types/api'

const keyword = ref('')
const results = ref<Post[]>([])
const loading = ref(false)
const error = ref('')
const searchedKeyword = ref('')
const { page, total, pageCount, pageSize, reset, go } = usePagination(12)
// 请求序号防竞态（useLatestRequest）：快速连续搜索时旧响应后到会被丢弃，不再覆盖新结果
const { next, isLatest, signal } = useLatestRequest()

async function search(resetPage = true) {
  if (!keyword.value.trim()) return
  if (resetPage) {
    searchedKeyword.value = keyword.value.trim()
    reset()
  }
  const seq = next()
  loading.value = true
  error.value = ''
  try {
    const res = await postApi.getList({ keyword: searchedKeyword.value, page: page.value, pageSize }, signal())
    if (!isLatest(seq)) return // 过期响应（已有更新的搜索请求发出）
    results.value = res.data.list
    total.value = res.data.total
  } catch {
    if (!isLatest(seq)) return
    // 失败必须复位 loading 并提示（原实现无 catch，请求失败后页面永久停在"搜索中..."）
    error.value = '搜索失败，请检查网络后重试'
  } finally {
    if (isLatest(seq)) loading.value = false
  }
}

function goPage(nextPage: number) {
  if (!go(nextPage)) return
  search(false)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function parse(p: Post) {
  return {
    id: p.id,
    title: p.title,
    game: p.game_name || `游戏ID:${p.game_id}`,
    category: p.category,
    tags: p.tags || [],
    views: p.view_count,
    likes: p.like_count,
    comments: p.comment_count,
    time: p.created_at?.slice(0, 10) || '',
    author: p.username || '匿名',
    icon: '🗡️',
    cover: p.cover || '',
    avatar: p.avatar || '',
    has_video: p.has_video === true,
  }
}
</script>

<template>
  <div style="max-width: 900px; margin: 0 auto; padding: 20px; color: var(--text-primary)">
    <div class="search-input-wrap" style="margin-bottom: 24px">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        style="width: 16px; height: 16px; color: var(--text-muted)"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        v-model="keyword"
        placeholder="搜索攻略..."
        style="flex: 1; background: none; border: none; outline: none; color: var(--text-primary); font-size: 0.9rem"
        @keyup.enter="search()"
      />
    </div>
    <div v-if="loading" style="text-align: center; color: var(--text-muted); padding: 40px">搜索中...</div>
    <div v-else-if="error" style="text-align: center; padding: 60px">
      <div style="color: var(--text-muted); margin-bottom: 12px">{{ error }}</div>
      <button
        style="
          padding: 6px 16px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 0.8rem;
          font-family: inherit;
        "
        @click="search(false)"
      >
        重试
      </button>
    </div>
    <div v-else-if="keyword && !results.length" style="text-align: center; color: var(--text-muted); padding: 60px">
      未找到相关攻略
    </div>
    <div v-else class="article-feed">
      <PostCard v-for="p in results" :key="p.id" :post="parse(p)" />
    </div>
    <AppPagination v-if="!loading && !error && results.length" :page="page" :page-count="pageCount" @change="goPage" />
  </div>
</template>

<style scoped>
.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 22px;
  padding: 10px 18px;
  max-width: 500px;
}
.search-input-wrap:focus-within {
  border-color: var(--amber);
}
.search-input-wrap input::placeholder {
  color: var(--text-muted);
}
.article-feed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
@media (min-width: 768px) {
  .article-feed {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }
}
</style>
