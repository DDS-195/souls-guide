<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { gameApi, postApi } from '../api'
import PostCard from '../components/PostCard.vue'
import { useLatestRequest } from '../composables/useLatestRequest'

function parsePost(p: any) {
  return {
    id: p.id,
    title: p.title,
    game: p.game_name || `游戏ID:${p.game_id}`,
    category: p.category,
    tags: p.tags || [],
    views: p.view_count || 0,
    likes: p.like_count || 0,
    comments: p.comment_count || 0,
    time: p.created_at?.slice(0, 10) || '',
    author: p.username || '匿名',
    user_id: p.user_id,
    icon: '🗡️',
    cover: p.cover || '',
    avatar: p.avatar || '',
  }
}

const activeGame = ref('all')
const activeSort = ref<'latest' | 'hot'>('latest')
const keyword = ref('')
const games = ref<{ id: number; name: string }[]>([])
const posts = ref<any[]>([])
const loading = ref(false)
const error = ref('')

// 首屏初始化：游戏列表 + 文章列表。失败进入错误态（可重试），不再静默白屏
async function init() {
  loading.value = true
  error.value = ''
  try {
    const res = await gameApi.getList()
    games.value = res.data
  } catch {
    error.value = '加载失败，请检查网络后重试'
    loading.value = false
    return
  }
  await fetchPosts() // fetchPosts 自带 loading/error 管理
}

onMounted(init)

// 请求序号防竞态（useLatestRequest）：快速切 Tab/排序/搜索时旧响应后到会被丢弃，不再覆盖新结果
const { next, isLatest } = useLatestRequest()

async function fetchPosts() {
  const seq = next()
  loading.value = true
  error.value = ''
  try {
    const params: any = { sort: activeSort.value }
    if (activeGame.value !== 'all') params.game_id = activeGame.value
    if (keyword.value) params.keyword = keyword.value
    const res = await postApi.getList(params)
    if (!isLatest(seq)) return // 过期响应（已有更新的筛选请求发出）
    posts.value = res.data.list
  } catch {
    if (!isLatest(seq)) return
    error.value = '加载失败，请重试'
  } finally {
    if (isLatest(seq)) loading.value = false
  }
}

function handleGameChange(key: string) {
  activeGame.value = key
  fetchPosts()
}

function handleSearch() {
  fetchPosts()
}

function toggleSort() {
  activeSort.value = activeSort.value === 'latest' ? 'hot' : 'latest'
  fetchPosts()
}
</script>

<template>
  <div>
    <div class="game-tabs-wrapper">
      <div class="game-tabs">
        <button class="game-tab" :class="{ active: activeGame === 'all' }" @click="handleGameChange('all')">
          全 部
        </button>
        <button
          v-for="g in games"
          :key="g.id"
          class="game-tab"
          :class="{ active: activeGame === String(g.id) }"
          @click="handleGameChange(String(g.id))"
        >
          {{ g.name }}
        </button>
      </div>
    </div>

    <div class="search-row">
      <div class="search-input-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input v-model="keyword" type="text" placeholder="搜索攻略..." @keyup.enter="handleSearch" />
      </div>
      <button class="sort-btn" :class="{ active: activeSort === 'hot' }" @click="toggleSort">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <polyline points="19 12 12 19 5 12" />
        </svg>
        {{ activeSort === 'latest' ? '最新' : '最热' }}
      </button>
    </div>

    <div v-if="loading" style="text-align: center; color: var(--text-muted); padding: 60px">加载中...</div>
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
        @click="init"
      >
        重新加载
      </button>
    </div>
    <div v-else class="article-feed">
      <PostCard v-for="p in posts" :key="p.id" :post="parsePost(p)" />
    </div>
  </div>
</template>

<style scoped>
.game-tabs-wrapper {
  margin-bottom: 24px;
  position: relative;
}
.game-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 4px 0;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  scroll-behavior: smooth;
}
.game-tabs::-webkit-scrollbar {
  display: none;
}
.game-tab {
  flex-shrink: 0;
  padding: 8px 18px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: all 150ms;
  white-space: nowrap;
}
.game-tab:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}
.game-tab.active {
  background: var(--amber);
  color: var(--on-amber);
  border-color: var(--amber);
  font-weight: 600;
}
.search-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}
.search-input-wrap {
  flex: 1;
  max-width: 500px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 22px;
  padding: 9px 18px;
  transition: border-color 150ms;
}
.search-input-wrap:focus-within {
  border-color: var(--amber);
}
.search-input-wrap input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.85rem;
  font-family: inherit;
}
.search-input-wrap input::placeholder {
  color: var(--text-muted);
}
.search-input-wrap svg {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.sort-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 9px 16px;
  border-radius: 20px;
  font-size: 0.8rem;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: all 150ms;
}
.sort-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}
.sort-btn.active {
  color: var(--amber);
  border-color: var(--amber);
}
.sort-btn svg {
  width: 14px;
  height: 14px;
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
@media (max-width: 767px) {
  .game-tab {
    padding: 7px 15px;
    font-size: 0.78rem;
  }
  .search-input-wrap {
    max-width: none;
  }
}
</style>
