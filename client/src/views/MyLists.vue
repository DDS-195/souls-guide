<script setup lang="ts">
// 我的列表单页（2026-08-07）：/me/following|followers|favorites|history 四路由共用本组件，
// 按 route.path 区分列表类型，每类独立分页、独立标题
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { gameApi, interactApi, postApi } from '../api'
import PostCard from '../components/PostCard.vue'
import { historyKey } from '../utils/history'
import { useLatestRequest } from '../composables/useLatestRequest'
import type { FollowUser, Game, HistorySnapshot, Post } from '../types/api'
import { useSelectionIndicator } from '../composables/useSelectionIndicator'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const TYPES = ['following', 'followers', 'favorites', 'history'] as const
type ListType = (typeof TYPES)[number]
const TITLE_MAP: Record<ListType, string> = {
  following: '我的关注',
  followers: '我的粉丝',
  favorites: '我的收藏',
  history: '浏览历史',
}

const type = ref<ListType>('following')
const title = ref('我的关注')
const isFollowingFeed = computed(() => type.value === 'following' && route.query.view === 'posts')
const followingTabs = ref<HTMLElement | null>(null)
const followingIndicator = useSelectionIndicator(followingTabs, [isFollowingFeed], '[aria-current="page"]')
const isArticleList = computed(() => type.value === 'favorites' || isFollowingFeed.value)
const gameId = computed(() => {
  const value = route.query.game
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined
})
const games = ref<Game[]>([])
const gamesError = ref(false)
const gamesLoading = ref(false)
let disposed = false
onScopeDispose(() => { disposed = true })
onMounted(loadGames)
async function loadGames() {
  if (gamesLoading.value) return
  gamesLoading.value = true
  gamesError.value = false
  try {
    // Inactive games retain their historical articles and must remain filterable.
    const res = await gameApi.getList(true)
    if (!disposed) games.value = res.data
  } catch {
    if (!disposed) gamesError.value = true
  } finally {
    if (!disposed) gamesLoading.value = false
  }
}
function changeGame(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  void router.replace({ path: route.path, query: { ...route.query, game:value || undefined } })
}
function changeFollowingView(posts: boolean) {
  void router.push({ path:'/me/following', query: { view:posts ? 'posts' : undefined } })
}
type ListItem = Partial<Post & FollowUser & HistorySnapshot> & { id: number }

const list = ref<ListItem[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')
const hasMore = ref(false)
let page = 1
const PAGE_SIZE = 10
// 请求序号防竞态（useLatestRequest）：快速在四个 Tab 间切换时，旧请求响应后到会被丢弃。
// 原实现 load() 里 `if (loading) return` 会把新 Tab 的请求直接丢掉 → 标题已切换但列表停在旧 Tab（数据错位）
const { next, isLatest, signal } = useLatestRequest()

// 历史记录：本地快照 + 实时补齐（2026-08-09 用户批准方案：GET /posts?ids= 批量取 published，
// 头像/封面/浏览数等与当前状态同步；ids 参数由 A2 实现，未实现时忽略 → 降级用本地快照）
// ⚠ 必须在 watch(immediate) 之前声明：immediate 在 setup 阶段同步触发 load()→loadHistory()，
// 声明在后则访问 historyAll 时处于 TDZ（Cannot access 'historyAll' before initialization），
// 异常被 load() 的 catch 吞掉 → 历史列表永远为空（2026-08-09 实测根因）
// ⚠ historyAll 必须 ref：script setup 顶层普通变量是 setup() 返回值拷贝，模板读不到新值（2026-08-09 实测坑）
const historyAll = ref<HistorySnapshot[]>([])
let realMap = new Map<number, Post>()

watch(
  () => [route.path, route.query.view, route.query.game],
  () => {
    const t = route.path.replace('/me/', '') as ListType
    type.value = TYPES.includes(t) ? t : 'following'
    title.value = TITLE_MAP[type.value]
    reload()
  },
  { immediate: true },
)

async function load(append = false) {
  const seq = next()
  loading.value = true
  loadError.value = ''
  try {
    if (type.value === 'history') {
      await loadHistory(seq)
      return
    }
    const uid = userStore.userInfo?.id
    if (!uid) return
    let items: ListItem[]
    let resultTotal: number
    if (!isFollowingFeed.value && (type.value === 'following' || type.value === 'followers')) {
      const res =
        type.value === 'following'
          ? await interactApi.getFollowing(uid, { page, pageSize: PAGE_SIZE }, signal())
          : await interactApi.getFollowers(uid, { page, pageSize: PAGE_SIZE }, signal())
      items = res.data.list
      resultTotal = res.data.total
    } else {
      const params = { page, pageSize:PAGE_SIZE, game_id:gameId.value }
      const res = isFollowingFeed.value
        ? await interactApi.getFollowingFeed(params, signal())
        : await interactApi.getFavorites(params, signal())
      items = res.data.list
      resultTotal = res.data.total
    }
    if (!isLatest(seq)) return // 已切换到其他 Tab，丢弃过期响应
    list.value = append ? [...list.value, ...items] : items
    total.value = resultTotal
    hasMore.value = list.value.length < total.value
  } catch {
    if (isLatest(seq)) {
      if (append) page = Math.max(1, page - 1)
      loadError.value = '列表加载失败，请重试'
    }
  } finally {
    if (isLatest(seq)) loading.value = false
  }
}

async function loadHistory(seq: number) {
  try {
    const raw = localStorage.getItem(historyKey(userStore.userInfo?.id))
    historyAll.value = raw ? JSON.parse(raw) : []
  } catch {
    historyAll.value = []
  }
  total.value = historyAll.value.length
  list.value = historyAll.value.slice(0, page * PAGE_SIZE)
  hasMore.value = list.value.length < total.value
  const ids = historyAll.value.map((item) => item.id).filter(Boolean)
  if (!ids.length) {
    realMap = new Map()
    return
  }
  try {
    const r = await postApi.getList({ ids: ids.join(','), pageSize: 50 })
    if (!isLatest(seq)) return // 已切换到其他 Tab，丢弃过期实时补齐结果
    realMap = new Map(r.data.list.map((post) => [post.id, post]))
  } catch {
    if (isLatest(seq)) realMap = new Map()
  }
}

function reload() {
  page = 1
  // 切换 Tab 立即清空旧列表，避免标题已切换而列表仍显示上一 Tab 数据的错位
  list.value = []
  total.value = 0
  hasMore.value = false
  load()
}

function loadMore() {
  if (!hasMore.value || loading.value) return
  page++
  load(true)
}

// 收藏/历史列表复用 PostCard（响应为文章摘要，game_name/category 缺失时给空串，PostCard 空值不渲染 badge）
function parsePost(p: ListItem) {
  return {
    id: p.id,
    title: p.title || '已失效攻略',
    game: p.game_name || (p.game_id ? `游戏ID:${p.game_id}` : ''),
    category: p.category || '',
    tags: p.tags || [],
    views: p.view_count || 0,
    likes: p.like_count || 0,
    comments: p.comment_count || 0,
    time: p.time || p.created_at?.slice(0, 10) || '',
    author: p.nickname || p.username || '匿名',
    user_id: p.user_id,
    icon: '🗡️',
    cover: p.cover || '',
    avatar: p.avatar || '',
    has_video: p.has_video === true,
  }
}

// 历史卡片：实时数据优先（头像/封面/标题等与当前状态同步），浏览时间用本地记录（历史语义）
function histPost(h: ListItem) {
  const real = realMap.get(h.id)
  return parsePost({ ...(real || h), time: h.time || real?.created_at?.slice(0, 10) || '' })
}
</script>

<template>
  <div class="my-lists" :aria-busy="loading">
    <!-- 页标题 -->
    <h1 class="list-title">{{ title }}</h1>
    <nav v-if="type === 'following'" ref="followingTabs" class="following-tabs" :class="{ 'has-indicator': followingIndicator.ready.value }" aria-label="关注内容">
      <span v-if="followingIndicator.ready.value" class="selection-indicator" :class="{ 'is-moving': followingIndicator.moving.value }" :style="followingIndicator.style.value" aria-hidden="true" />
      <button :aria-current="!isFollowingFeed ? 'page' : undefined" @click="changeFollowingView(false)">关注作者</button>
      <button :aria-current="isFollowingFeed ? 'page' : undefined" @click="changeFollowingView(true)">最新攻略</button>
    </nav>
    <div v-if="isArticleList" class="list-toolbar">
      <label class="game-filter">游戏
        <select :value="gameId || ''" :disabled="gamesLoading" @change="changeGame">
          <option value="">全部游戏</option>
          <option v-if="gameId && !games.some(g => g.id === gameId)" :value="gameId">游戏 #{{ gameId }}</option>
          <option v-for="g in games" :key="g.id" :value="g.id">{{ g.name }}{{ g.status === 0 ? '（已停用）' : '' }}</option>
        </select>
      </label>
      <span class="list-count" role="status">{{ loading ? '加载中…' : `${total} 篇攻略` }}</span>
      <button class="text-button" :disabled="loading" @click="reload">刷新</button>
    </div>
    <p v-if="isArticleList && gamesError" class="list-notice" role="alert">游戏选项加载失败，仍可查看全部攻略。<button class="text-button" @click="loadGames">重试</button></p>
    <p v-if="loadError" class="list-notice" role="alert">{{ loadError }} <button class="text-button" :disabled="loading" @click="list.length ? loadMore() : reload()">重试</button></p>
    <p v-if="loading && !list.length" class="empty-state" role="status">加载中…</p>

    <!-- 用户列表：关注 / 粉丝 -->
    <template v-if="!isFollowingFeed && (type === 'following' || type === 'followers')">
      <div v-if="!loading && !loadError && !list.length" class="empty-state">
        暂无{{ type === 'following' ? '关注' : '粉丝' }}
      </div>
      <div v-else class="user-list">
        <router-link v-for="u in list" :key="u.id" class="user-row" :to="`/user/${u.id}`">
          <img v-if="u.avatar" class="u-avatar" :src="u.avatar" alt="" loading="lazy" />
          <span
            v-else
            class="u-avatar"
            style="
              background: linear-gradient(135deg, var(--amber-dim), var(--amber));
              color: var(--bg-deep);
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: 700;
            "
            >{{ (u.nickname || u.username || 'U').charAt(0) }}</span
          >
          <div style="flex: 1; min-width: 0">
            <div style="font-size: 0.9rem; font-weight: 600">{{ u.nickname || u.username }}</div>
            <div v-if="u.username !== u.nickname" style="font-size: 0.75rem; color: var(--text-muted)">
              @{{ u.username }}
            </div>
          </div>
          <span style="font-size: 0.72rem; color: var(--text-muted); flex-shrink: 0">{{
            (u.followed_at || '').slice(0, 10)
          }}</span>
        </router-link>
      </div>
    </template>

    <!-- 收藏（文章卡片） -->
    <template v-else-if="isArticleList">
      <div v-if="!loading && !loadError && !list.length" class="empty-state">
        <p>{{ gameId ? '该游戏暂无攻略' : isFollowingFeed ? '关注的作者暂未发布攻略' : '还没有收藏攻略' }}</p>
        <button v-if="gameId" class="text-button" @click="router.replace({ path: route.path, query: { ...route.query, game:undefined } })">查看全部游戏</button>
        <button v-else-if="isFollowingFeed" class="text-button" @click="changeFollowingView(false)">查看关注作者</button>
        <router-link v-else class="text-button" to="/">去发现攻略</router-link>
      </div>
      <div v-else class="article-feed">
        <PostCard v-for="(p, index) in list" :key="p.id" :post="parsePost(p)" :eager="index < 3" :priority="index === 0" />
      </div>
    </template>

    <!-- 浏览历史（本地 + 实时补齐，与收藏同款文章卡片） -->
    <template v-else>
      <div v-if="!loading && !historyAll.length" style="text-align: center; color: var(--text-muted); padding: 60px">
        暂无浏览记录
      </div>
      <div v-else class="article-feed">
        <PostCard v-for="h in list" :key="h.id" :post="histPost(h)" />
      </div>
    </template>

    <!-- 加载更多 -->
    <div v-if="hasMore" style="text-align: center; margin-top: 20px">
      <button class="ml-more" :disabled="loading" @click="loadMore">{{ loading ? '加载中...' : '加载更多' }}</button>
    </div>
  </div>
</template>

<style scoped>
.my-lists { max-width: 1000px; margin: 0 auto; padding: 20px 16px 40px; color: var(--text-primary); }
.list-title { font-size: 1.05rem; font-weight: 600; margin: 0 0 18px; }
.following-tabs { position: relative; display: flex; gap: 8px; padding: 4px; border: 1px solid var(--border-subtle); border-radius: 10px; margin-bottom: 18px; width: fit-content; }
.following-tabs button { position: relative; z-index: 1; border: 0; padding: 8px 14px; border-radius: 7px; background: none; color: var(--text-muted); font: inherit; font-size: .88rem; cursor: pointer; transition: color 180ms ease; }
.following-tabs button[aria-current="page"] { color: var(--amber); background: var(--amber-glow); }
.following-tabs.has-indicator button[aria-current="page"] { background: transparent; }
.following-tabs .selection-indicator { background: var(--amber-glow); border-radius: 7px; }
.list-toolbar { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; font-size: .8rem; }
.game-filter { display: flex; align-items: center; gap: 10px; min-width: 0; color: var(--text-secondary); }
.game-filter select { width: 180px; max-width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--bg-card); color: var(--text-primary); font: inherit; }
.list-count { color: var(--text-muted); margin-left: auto; white-space: nowrap; }
.text-button { padding: 4px 0; border: 0; background: none; color: var(--amber); font: inherit; cursor: pointer; text-decoration: none; white-space: nowrap; }
.text-button:disabled { opacity: .5; cursor: default; }
.empty-state { text-align: center; color: var(--text-muted); padding: 48px 16px; font-size: .88rem; }
.empty-state p { margin: 0 0 12px; }
.list-notice { color: var(--text-muted); font-size: .8rem; }
.list-notice button { margin-left: 8px; }
@media (max-width: 480px) { .list-toolbar { gap: 10px; } .game-filter { flex: 1; gap: 6px; } .game-filter select { flex: 1; width: 0; } }
.user-list {
  display: flex;
  flex-direction: column;
}
.user-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  transition: background 150ms;
}
.user-row:hover {
  background: var(--bg-hover);
}
.u-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  font-size: 1.05rem;
}

.article-feed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
@media (min-width: 768px) {
  .article-feed {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
  }
}
@media (min-width: 960px) { .article-feed { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

.ml-more {
  padding: 8px 28px;
  border-radius: 16px;
  font-size: 0.8rem;
  cursor: pointer;
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  font-family: inherit;
  transition: all 150ms;
}
.ml-more:hover:not(:disabled) {
  color: var(--amber);
  border-color: var(--amber);
}
.ml-more:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
