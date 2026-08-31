<script setup lang="ts">
// 我的列表单页（2026-08-07）：/me/following|followers|favorites|history 四路由共用本组件，
// 按 route.path 区分列表类型，每类独立分页、独立标题
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { interactApi, postApi } from '../api'
import PostCard from '../components/PostCard.vue'
import { useLatestRequest } from '../composables/useLatestRequest'

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
const list = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const hasMore = ref(false)
let page = 1
const PAGE_SIZE = 10
// 请求序号防竞态（useLatestRequest）：快速在四个 Tab 间切换时，旧请求响应后到会被丢弃。
// 原实现 load() 里 `if (loading) return` 会把新 Tab 的请求直接丢掉 → 标题已切换但列表停在旧 Tab（数据错位）
const { next, isLatest } = useLatestRequest()

// 历史记录：本地快照 + 实时补齐（2026-08-09 用户批准方案：GET /posts?ids= 批量取 published，
// 头像/封面/浏览数等与当前状态同步；ids 参数由 A2 实现，未实现时忽略 → 降级用本地快照）
// ⚠ 必须在 watch(immediate) 之前声明：immediate 在 setup 阶段同步触发 load()→loadHistory()，
// 声明在后则访问 historyAll 时处于 TDZ（Cannot access 'historyAll' before initialization），
// 异常被 load() 的 catch 吞掉 → 历史列表永远为空（2026-08-09 实测根因）
// ⚠ historyAll 必须 ref：script setup 顶层普通变量是 setup() 返回值拷贝，模板读不到新值（2026-08-09 实测坑）
const historyAll = ref<any[]>([])
let realMap = new Map<number, any>()

watch(
  () => route.path,
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
  try {
    if (type.value === 'history') {
      await loadHistory(seq)
      return
    }
    const uid = userStore.userInfo?.id
    if (!uid) return
    const res: any =
      type.value === 'following'
        ? await interactApi.getFollowing(uid, { page, pageSize: PAGE_SIZE })
        : type.value === 'followers'
          ? await interactApi.getFollowers(uid, { page, pageSize: PAGE_SIZE })
          : await interactApi.getFavorites({ page, pageSize: PAGE_SIZE })
    if (!isLatest(seq)) return // 已切换到其他 Tab，丢弃过期响应
    const data = res.data || {}
    const items = data.list || []
    list.value = append ? [...list.value, ...items] : items
    total.value = data.total || 0
    hasMore.value = list.value.length < total.value
  } catch {
    /* 列表失败保持现状 */
  } finally {
    if (isLatest(seq)) loading.value = false
  }
}

async function loadHistory(seq: number) {
  try {
    const raw = localStorage.getItem('viewHistory')
    historyAll.value = raw ? JSON.parse(raw) : []
  } catch {
    historyAll.value = []
  }
  total.value = historyAll.value.length
  list.value = historyAll.value.slice(0, page * PAGE_SIZE)
  hasMore.value = list.value.length < total.value
  const ids = historyAll.value.map((h: any) => h.id).filter(Boolean)
  if (!ids.length) {
    realMap = new Map()
    return
  }
  try {
    const r: any = await postApi.getList({ ids: ids.join(','), pageSize: 50 })
    if (!isLatest(seq)) return // 已切换到其他 Tab，丢弃过期实时补齐结果
    realMap = new Map((r.data?.list || []).map((p: any) => [p.id, p]))
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
function parsePost(p: any) {
  return {
    id: p.id,
    title: p.title,
    game: p.game_name || (p.game_id ? `游戏ID:${p.game_id}` : ''),
    category: p.category || '',
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

// 历史卡片：实时数据优先（头像/封面/标题等与当前状态同步），浏览时间用本地记录（历史语义）
function histPost(h: any) {
  const real = realMap.get(h.id)
  return parsePost({ ...(real || h), time: h.time || real?.created_at?.slice(0, 10) || '' })
}
</script>

<template>
  <div style="max-width: 900px; margin: 0 auto; padding: 20px 16px 40px; color: var(--text-primary)">
    <!-- 页标题 -->
    <div style="font-size: 1.05rem; font-weight: 600; margin-bottom: 18px">{{ title }}</div>

    <!-- 用户列表：关注 / 粉丝 -->
    <template v-if="type === 'following' || type === 'followers'">
      <div v-if="!loading && !list.length" style="text-align: center; color: var(--text-muted); padding: 60px">
        暂无{{ type === 'following' ? '关注' : '粉丝' }}
      </div>
      <div v-else class="user-list">
        <div v-for="u in list" :key="u.id" class="user-row" @click="router.push(`/user/${u.id}`)">
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
        </div>
      </div>
    </template>

    <!-- 收藏（文章卡片） -->
    <template v-else-if="type === 'favorites'">
      <div v-if="!loading && !list.length" style="text-align: center; color: var(--text-muted); padding: 60px">
        暂无收藏
      </div>
      <div v-else class="article-feed">
        <PostCard v-for="p in list" :key="p.id" :post="parsePost(p)" />
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
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }
}

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
