<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { gameApi, postApi } from '../api'
import PostCard from '../components/PostCard.vue'
import PostCardSkeleton from '../components/PostCardSkeleton.vue'
import { captureResultLayout, playResultTransition, type ResultSnapshot } from '../utils/resultMotion'
import AppPagination from '../components/AppPagination.vue'
import { useLatestRequest } from '../composables/useLatestRequest'
import { homeScroll, rememberHomeScroll } from '../composables/homeScroll'
import type { Game, Post, PostListQuery } from '../types/api'
import { homeLayout } from '../utils/homeLayout'
import { CATEGORIES } from '../utils/guide'
import { useSelectionIndicator } from '../composables/useSelectionIndicator'
import { playArticleReturn } from '../utils/articleMotion'
import { useHorizontalDrag } from '../composables/useHorizontalDrag'

const viewportWidth = ref(window.innerWidth)
const clientWidth = ref(document.documentElement.clientWidth)
const feedContainer = ref<HTMLElement | null>(null)
const measuredWidth = ref<number>()
const imageLayout = computed(() => homeLayout(viewportWidth.value, clientWidth.value, measuredWidth.value))
let resizeFrame = 0
let layoutObserver: ResizeObserver | undefined
function updateLayout() {
  if (resizeFrame) return
  resizeFrame = requestAnimationFrame(() => {
    const oldSize = imageLayout.value.pageSize
    const anchor = captureResizeAnchor()
    viewportWidth.value = window.innerWidth
    clientWidth.value = document.documentElement.clientWidth
    measuredWidth.value = feedContainer.value?.getBoundingClientRect().width
    if (imageLayout.value.pageSize !== oldSize) resizeAnchor ??= anchor
    resizeFrame = 0
  })
}
onMounted(() => {
  window.addEventListener('resize', updateLayout, { passive: true })
  if (typeof ResizeObserver !== 'undefined' && feedContainer.value) {
    layoutObserver = new ResizeObserver(updateLayout)
    layoutObserver.observe(feedContainer.value)
  }
  updateLayout()
})
onUnmounted(() => {
  window.removeEventListener('resize', updateLayout)
  cancelAnimationFrame(resizeFrame)
  layoutObserver?.disconnect()
})

const route = useRoute()
const router = useRouter()
const scalar = (v: unknown) => typeof v === 'string' ? v : ''
const activeGame = computed(() => /^[1-9]\d*$/.test(scalar(route.query.game)) ? String(route.query.game) : 'all')
const activeSort = computed(() => route.query.sort === 'hot' ? 'hot' : 'latest')
const appliedKeyword = computed(() => scalar(route.query.q).trim().slice(0, 200))
const activeCategory = computed(() => CATEGORIES.includes(scalar(route.query.category)) ? scalar(route.query.category) : '')
const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isSafeInteger(n) && n > 0 ? n : 1
})
const keyword = ref('')
const games = ref<Game[]>([])
const gameTabs = ref<HTMLElement | null>(null)
const gameIndicator = useSelectionIndicator(gameTabs, [activeGame, games])
const sortTabs = ref<HTMLElement | null>(null)
const sortIndicator = useSelectionIndicator(sortTabs, [activeSort])
const gameDrag = useHorizontalDrag(gameTabs, [games, activeGame])
const posts = ref<Post[]>([])
const cards = computed(() => posts.value.map(parsePost))
const loading = ref(true)
const results = ref<HTMLElement | null>(null)
let animateNextResults = false
const loadingMessage = computed(() => loading.value ? (posts.value.length ? '正在更新，暂显示上一组结果…' : '正在加载攻略…') : '')
const error = ref('')
const gameError = ref('')
const total = ref(0)
const pageSize = computed(() => imageLayout.value.pageSize)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
type ResizeAnchor = { id: string; top: number; index: number }
let resizeAnchor: ResizeAnchor | undefined
let resizeLocation: string | undefined
let displayedPage = 1
let displayedPageSize = pageSize.value
function captureResizeAnchor(): ResizeAnchor | undefined {
  const elements = results.value?.querySelectorAll<HTMLElement>('[data-post-id]')
  const element = elements && Array.from(elements).find(card => card.getBoundingClientRect().bottom > 0)
  const index = posts.value.findIndex(post => String(post.id) === element?.dataset.postId)
  if (!element || index < 0) return
  return { id: element.dataset.postId!, top: element.getBoundingClientRect().top, index: (displayedPage - 1) * displayedPageSize + index }
}
const { next, isLatest, signal } = useLatestRequest()
onUnmounted(() => next())
onBeforeRouteLeave(() => { rememberHomeScroll(route.fullPath) })
async function loadGames() {
  gameError.value = ''
  try { games.value = (await gameApi.getList()).data }
  catch { gameError.value = '游戏分类加载失败，仍可浏览全部文章。' }
}
onMounted(loadGames)
async function navigate(changes: Record<string, string | undefined>) {
  resizeAnchor = undefined
  resizeLocation = undefined
  rememberHomeScroll(route.fullPath)
  animateNextResults = true
  try {
    const failure = await router.push({ path: '/', query: { ...route.query, ...changes } })
    if (failure) animateNextResults = false
  } catch { animateNextResults = false }
}
function handleGameChange(game: string) { navigate({ game: game === 'all' ? undefined : game, page: undefined }) }
function handleSearch() {
  keyword.value = keyword.value.trim().slice(0, 200)
  if (keyword.value === appliedKeyword.value && page.value === 1) { refreshPosts(); return }
  navigate({ q: keyword.value || undefined, page: undefined })
}
function chooseSort(sort: string) { navigate({ sort: sort === 'hot' ? 'hot' : undefined, page: undefined }) }
function goPage(n: number) { if (n >= 1 && n <= pageCount.value) navigate({ page: n === 1 ? undefined : String(n) }) }
function clearFilters() { navigate({ game: undefined, category: undefined, q: undefined, sort: undefined, page: undefined }) }
function refreshPosts() { animateNextResults = true; void fetchPosts() }
async function fetchPosts() {
  const seq = next()
  const animateResults = animateNextResults
  animateNextResults = false
  let committed = false
  let previousLayout: ResultSnapshot[] = []
  const location = route.fullPath
  loading.value = true
  error.value = ''
  try {
    const params: PostListQuery = { sort: activeSort.value, page: page.value, pageSize: pageSize.value }
    if (activeGame.value !== 'all') params.game_id = activeGame.value
    if (appliedKeyword.value) params.keyword = appliedKeyword.value
    if (activeCategory.value) params.category = activeCategory.value
    const res = await postApi.getList(params, signal())
    if (!isLatest(seq)) return
    total.value = res.data.total
    if (page.value > pageCount.value) {
      await router.replace({ query: { ...route.query, page: pageCount.value > 1 ? String(pageCount.value) : undefined } })
      return
    }
    if (animateResults) previousLayout = captureResultLayout(results.value)
    posts.value = res.data.list
    displayedPage = params.page!
    displayedPageSize = params.pageSize!
    committed = true
  } catch {
    if (isLatest(seq)) error.value = '文章加载失败，请重试'
  } finally {
    if (isLatest(seq)) {
      loading.value = false
      await nextTick()
      if (isLatest(seq)) {
        if (resizeAnchor) {
          const element = results.value?.querySelector<HTMLElement>(`[data-post-id="${resizeAnchor.id}"]`)
          if (element && committed) window.scrollTo({ left: 0, top: window.scrollY + element.getBoundingClientRect().top - resizeAnchor.top, behavior: 'instant' })
          if (committed) resizeAnchor = undefined
        } else {
          window.scrollTo({ left: 0, top: homeScroll.get(location) ?? 0, behavior: 'instant' })
          playArticleReturn(results.value)
        }
        if (committed && animateResults) playResultTransition(results.value, previousLayout)
      }
    }
  }
}
watch([() => route.fullPath, pageSize], ([location, size], [previousLocation, previousSize]) => {
  if (previousLocation === location && previousSize && previousSize !== size) {
    const index = resizeAnchor?.index ?? ((page.value - 1) * previousSize)
    const targetPage = Math.floor(index / size) + 1
    if (targetPage !== page.value) {
      next()
      const target = { path: '/', query: { ...route.query, page: targetPage > 1 ? String(targetPage) : undefined } }
      resizeLocation = router.resolve(target).fullPath
      void router.replace(target).catch(() => {
        resizeLocation = undefined
        resizeAnchor = undefined
        void fetchPosts()
      })
      return
    }
  } else if (previousLocation !== location) {
    if (location !== resizeLocation) resizeAnchor = undefined
    resizeLocation = undefined
  }
  keyword.value = appliedKeyword.value
  fetchPosts()
}, { immediate: true })
function parsePost(p: Post) {
  const date = new Date(p.published_at || p.created_at || '')
  return {
    id: p.id, title: p.title, game: p.game_name || '未分类', category: p.category,
    tags: p.tags || [], views: p.view_count || 0, likes: p.like_count || 0,
    comments: p.comment_count || 0,
    time: Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN'),
    author: p.nickname || p.username || '匿名', user_id: p.user_id,
    icon: '🗡️', cover: p.cover || '', avatar: p.avatar || '',
    has_video: p.has_video === true,
  }
}
</script>

<template>
  <div ref="feedContainer" class="home-page" :class="{ 'home-page--narrow': imageLayout.stackToolbar }" :style="{ '--home-columns': imageLayout.columns, '--home-gap': `${imageLayout.gap}px` }">
    <div class="game-tabs-wrapper">
      <div ref="gameTabs" class="game-tabs" :class="{ 'is-dragging': gameDrag.dragging.value, 'has-indicator': gameIndicator.ready.value }" role="group" aria-label="游戏分类，可横向拖动" @pointerdown="gameDrag.start" @click.capture="gameDrag.guardClick" @focusin="gameDrag.focus" @dragstart.prevent>
        <span v-if="gameIndicator.ready.value" class="selection-indicator" :class="{ 'is-moving': gameIndicator.moving.value }" :style="gameIndicator.style.value" aria-hidden="true" />
        <button class="game-tab" :aria-pressed="activeGame === 'all'" :class="{ active: activeGame === 'all' }" @click="handleGameChange('all')">
          <span>全 部</span>
        </button>
        <button
          v-for="g in games"
          :key="g.id"
          class="game-tab"
          :aria-pressed="activeGame === String(g.id)"
          :class="{ active: activeGame === String(g.id) }"
          @click="handleGameChange(String(g.id))"
        >
          <span>{{ g.name }}</span>
        </button>
      </div>
    </div>

    <p v-if="gameError" class="game-error">{{ gameError }} <button @click="loadGames">重试</button></p>
    <form class="search-row" @submit.prevent="handleSearch">
      <div class="search-input-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input v-model="keyword" type="search" maxlength="200" aria-label="搜索攻略标题或标签" placeholder="搜索攻略标题或标签..." />
        <button class="search-submit" type="submit">搜索</button>
      </div>
      <select class="category-filter" aria-label="攻略分类" :value="activeCategory" @change="navigate({ category: ($event.target as HTMLSelectElement).value || undefined, page: undefined })">
        <option value="">全部分类</option><option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
      </select>
      <div ref="sortTabs" class="sort-tabs" :class="{ 'has-indicator': sortIndicator.ready.value }" role="group" aria-label="排序方式">
        <span v-if="sortIndicator.ready.value" class="selection-indicator" :class="{ 'is-moving': sortIndicator.moving.value }" :style="sortIndicator.style.value" aria-hidden="true" />
        <button v-for="sort in [{ key: 'latest', label: '最新发布' }, { key: 'hot', label: '最多浏览' }]" :key="sort.key" type="button" :class="{ active: activeSort === sort.key }" :aria-pressed="activeSort === sort.key" @click="chooseSort(sort.key)">{{ sort.label }}</button>
      </div>
    </form>

    <p class="loading-status" :class="{ 'loading-status--hidden': !appliedKeyword || !!error }" role="status" aria-live="polite">{{ loadingMessage || (!error && appliedKeyword ? `“${appliedKeyword}” · ${total} 篇文章` : '') }}</p>
    <div class="results-shell" :aria-busy="loading">
    <div v-if="loading && !posts.length" class="article-feed" aria-hidden="true">
      <PostCardSkeleton v-for="n in imageLayout.columns * 2" :key="n" />
    </div>
    <div v-else-if="error" style="text-align: center; padding: 60px" role="alert">
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
        @click="refreshPosts"
      >
        重新加载
      </button>
    </div>
    <div v-else ref="results" :inert="loading || undefined" :class="{ 'results-stale': loading }">
    <div v-if="!posts.length" class="empty-state" role="status">
      <h3>暂无匹配文章</h3>
      <p>{{ appliedKeyword || activeCategory || activeGame !== 'all' ? '试试其他关键词、游戏或攻略分类' : '新的攻略发布后会显示在这里' }}</p>
      <button v-if="appliedKeyword || activeCategory || activeGame !== 'all'" @click="clearFilters">清除筛选</button>
    </div>
    <div v-else class="article-feed">
      <PostCard v-for="(p, index) in cards" :key="p.id" :post="p" :image-sizes="imageLayout.imageSizes" :max-image-width="imageLayout.maxImageWidth" :eager="index < imageLayout.eagerCount" :priority="index < imageLayout.priorityCount" compact />
    </div>
    <AppPagination v-if="total > 0" :page="page" :page-count="pageCount" @change="goPage" />
    </div>
    </div>
  </div>
</template>

<style scoped>
.home-page { min-width: 0; }
.category-filter { background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:9px 12px; font:inherit; font-size:.8rem; min-width:0; }
.game-tabs-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-bottom: 24px;
  position: relative;
}
.game-tabs {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding: 4px 0;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  user-select: none;
  cursor: grab;
  overscroll-behavior-x: contain;
}
.game-tabs::-webkit-scrollbar { display: none; }
.game-tabs .game-tab { cursor: grab; }
.game-tabs.is-dragging, .game-tabs.is-dragging .game-tab { cursor: grabbing; }
.game-tab:focus-visible { outline: 2px solid var(--amber); outline-offset: -2px; }
.game-tab {
  position: relative;
  flex-shrink: 0;
  padding: 8px 18px;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: background-color 180ms ease, color 180ms ease, border-color 180ms ease;
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
  font-weight: 500;
}
.game-tabs.has-indicator .game-tab.active { background: transparent; border-color: transparent; }
.game-tabs .selection-indicator { z-index: 1; }
.game-tab > span { position: relative; z-index: 2; }
.sort-tabs { position: relative; display: flex; flex-shrink: 0; padding: 3px; border: 1px solid var(--border-subtle); border-radius: 20px; background: var(--bg-card); }
.sort-tabs button { position: relative; z-index: 1; padding: 7px 11px; border: 0; border-radius: 16px; background: transparent; color: var(--text-muted); font: inherit; font-size: .78rem; white-space: nowrap; cursor: pointer; transition: color 180ms ease; }
.sort-tabs button.active { background: var(--amber-glow); color: var(--amber); }
.sort-tabs.has-indicator button.active { background: transparent; }
.sort-tabs .selection-indicator { background: var(--amber-glow); border-radius: 16px; }
.search-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.search-input-wrap {
  flex: 1 1 220px;
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
  transition: background-color 180ms ease, color 180ms ease, border-color 180ms ease;
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
  gap: var(--home-gap);
}
@media (min-width: 768px) {
  .article-feed {
    display: grid;
    grid-template-columns: repeat(var(--home-columns), minmax(0, 1fr));
    gap: var(--home-gap);
  }
}
@media (max-width: 767px) {
  .game-tabs-wrapper { margin-bottom:12px; }
  .search-row { flex-wrap:wrap; gap:8px; margin-bottom:12px; }
  .search-input-wrap { flex:1 1 100%; }
  .category-filter { flex:1; }
  .article-feed { gap:10px; }
  .game-tab {
    padding: 7px 15px;
    font-size: 0.78rem;
  }
  .search-input-wrap {
    max-width: none;
  }
}

.search-input-wrap, .search-input-wrap input { min-width: 0; }
.search-input-wrap { max-width: none; padding: 8px 12px; }
.home-page--narrow .search-input-wrap { flex: 1 1 100%; }
.home-page--narrow .category-filter { flex: 1; }
.search-submit, .empty-state button, .game-error button { border: 0; background: transparent; color: var(--amber); cursor: pointer; white-space: nowrap; font: inherit; }
.result-summary, .game-error { color: var(--text-secondary); font-size: .8rem; margin-bottom: 16px; overflow-wrap: anywhere; }
.empty-state { text-align: center; padding: 48px 16px; color: var(--text-secondary); }
.empty-state p { margin: 12px 0 20px; }
@media (max-width: 400px) { .search-row { gap: 6px; } .sort-btn { padding: 9px 10px; } }
.results-shell { position:relative; }
.loading-status { min-height:20px; margin:0 0 8px; color:var(--text-muted); font-size:.75rem; }
.loading-status--hidden { position:absolute; width:1px; height:1px; min-height:0; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.results-stale { opacity:.65; pointer-events:none; }
@media (prefers-reduced-motion: reduce) { .game-tab, .sort-btn { transition:none; } }
</style>
