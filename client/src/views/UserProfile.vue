<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { userApi, interactApi, postApi } from '../api'
import { useLatestRequest } from '../composables/useLatestRequest'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const profile = ref<any>(null)
const loading = ref(true)
const notFound = ref(false)
const avatarFailed = ref(false)
const following = ref(false)

const posts = ref<any[]>([])
const postPage = ref(1)
const postTotal = ref(0)
const postsLoading = ref(false)
// 请求序号防竞态（useLatestRequest）：快速切换用户（/user/1 → /user/2）时，旧请求的响应回来后经序号比对直接丢弃，
// 防止旧资料/旧文章列表覆盖新页面（原实现 loadPosts 用 postsLoading 直接 return，会把新用户的请求也丢掉）
const { seq: latestSeq, next, isLatest } = useLatestRequest()

/** 是否自己的主页（展示编辑入口而非关注按钮） */
const isSelf = computed(() => !!userStore.userInfo?.id && profile.value?.id === userStore.userInfo.id)
const roleLabel = computed(() => {
  if (profile.value?.role === 'admin') return '管理员'
  if (profile.value?.role === 'creator') return '创作者'
  return '玩家'
})

async function load(id: number) {
  const seq = next()
  loading.value = true
  posts.value = []
  postTotal.value = 0
  following.value = false
  try {
    const res: any = await userApi.getProfile(id)
    if (!isLatest(seq)) return // 已切换到其他用户，丢弃过期响应
    profile.value = res.data
    // 带 token 时后端返回 is_followed（公开接口可选鉴权，见 D19）
    following.value = !!res.data.is_followed
    loadPosts(id, 1)
  } catch {
    if (!isLatest(seq)) return
    notFound.value = true
  } finally {
    if (isLatest(seq)) loading.value = false
  }
}

onMounted(() => {
  const id = +route.params.id
  if (!Number.isInteger(id) || id < 1) {
    notFound.value = true
    loading.value = false
    return
  }
  load(id)
})

// 同一组件路由参数变化（如 /user/1 → /user/2）时组件不会重新挂载，需监听重新加载
watch(
  () => route.params.id,
  (v) => {
    const id = +v
    notFound.value = false
    if (!Number.isInteger(id) || id < 1) {
      notFound.value = true
      loading.value = false
      return
    }
    load(id)
  },
)

/** 该作者的已发布文章列表（GET /posts?user_id= 按作者过滤，分页 10 条，见 D19） */
async function loadPosts(userId: number, page = 1, append = false) {
  // 仅「加载更多」连点（append）拒绝并发；切换用户的首屏请求（append=false）必须放行，
  // 否则新用户的列表会被旧请求的 postsLoading 锁死丢失（旧响应由序号丢弃）
  if (postsLoading.value && append) return
  const seq = latestSeq.value
  if (!isLatest(seq)) return // 用户已切换，不再发起过期请求
  postsLoading.value = true
  try {
    const res: any = await postApi.getList({ user_id: userId, page, pageSize: 10 })
    if (!isLatest(seq)) return
    postPage.value = page
    postTotal.value = res.data.total || 0
    const list = res.data.list || []
    posts.value = append ? [...posts.value, ...list] : list
  } catch {
    /* 列表失败不阻塞主页信息展示 */
  } finally {
    if (isLatest(seq)) postsLoading.value = false
  }
}

/** 关注/取消关注（POST /follows/:id 为 toggle，返回 following） */
async function toggleFollow() {
  if (!userStore.token) return router.push('/login')
  const res: any = await interactApi.follow(profile.value.id)
  following.value = res.data.following
  profile.value.follower_count = Math.max(0, profile.value.follower_count + (following.value ? 1 : -1))
}
</script>

<template>
  <div class="profile-page">
    <div v-if="loading" class="empty">加载中...</div>
    <div v-else-if="notFound" class="empty">用户不存在或已被删除</div>

    <div v-else-if="profile" class="profile-wrap">
      <!-- 信息卡 -->
      <div class="profile-card">
        <div class="profile-head">
          <div class="avatar">
            <img v-if="profile.avatar && !avatarFailed" :src="profile.avatar" alt="头像" @error="avatarFailed = true" />
            <span v-else>{{ (profile.nickname || profile.username || 'U').charAt(0) }}</span>
          </div>
          <div class="profile-info">
            <div class="name-row">
              <span class="display-name">{{ profile.nickname || profile.username }}</span>
              <span class="role-badge" :class="profile.role">{{ roleLabel }}</span>
            </div>
            <div class="username">@{{ profile.username }}</div>
            <div v-if="profile.bio" class="bio">{{ profile.bio }}</div>
            <div class="join-date">加入于 {{ profile.created_at?.slice(0, 10) }}</div>
          </div>
          <router-link v-if="isSelf" to="/me/edit" class="edit-btn">编辑资料</router-link>
          <button v-else class="follow-btn" :class="{ followed: following }" @click="toggleFollow">
            {{ following ? '已关注' : '关注' }}
          </button>
        </div>
      </div>

      <!-- 统计条 -->
      <div class="stats-row">
        <div class="stat">
          <div class="stat-num">{{ profile.post_count }}</div>
          <div class="stat-label">文章</div>
        </div>
        <div class="stat">
          <div class="stat-num">{{ profile.follower_count }}</div>
          <div class="stat-label">粉丝</div>
        </div>
        <div class="stat">
          <div class="stat-num">{{ profile.following_count }}</div>
          <div class="stat-label">关注</div>
        </div>
      </div>

      <!-- 文章列表 -->
      <div class="posts-section">
        <div class="section-title">{{ isSelf ? '我的文章' : 'TA 的文章' }}</div>
        <div v-if="postsLoading && !posts.length" class="empty">加载中...</div>
        <div v-else-if="!posts.length" class="empty">还没有发布文章</div>
        <div v-for="p in posts" :key="p.id" class="post-item" @click="router.push(`/post/${p.id}`)">
          <div v-if="p.cover" class="post-cover"><img :src="p.cover" alt="封面" /></div>
          <div v-else class="post-cover cover-placeholder">🗡️</div>
          <div class="post-body">
            <div class="post-title">{{ p.title }}</div>
            <div class="post-badges">
              <span class="badge badge-game">{{ p.game_name || `游戏ID:${p.game_id}` }}</span>
              <span class="badge badge-cat">{{ p.category }}</span>
            </div>
            <div class="post-stats">
              <span>👁 {{ p.view_count || 0 }}</span>
              <span>❤️ {{ p.like_count || 0 }}</span>
              <span>💬 {{ p.comment_count || 0 }}</span>
              <span class="post-time">{{ p.created_at?.slice(0, 10) }}</span>
            </div>
          </div>
        </div>
        <button
          v-if="posts.length && posts.length < postTotal"
          class="load-more"
          :disabled="postsLoading"
          @click="loadPosts(profile.id, postPage + 1, true)"
        >
          {{ postsLoading ? '加载中...' : '加载更多' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-page {
  min-height: 100vh;
  background: var(--bg-deep);
  padding: 16px 16px calc(40px + env(safe-area-inset-bottom));
}
@media (min-width: 768px) {
  /* 桌面端氛围背景：篝火光晕渐变（原为外链 Unsplash 图片，国内加载不稳定/失败，
     改为纯 CSS 多层 radial-gradient，颜色走设计变量、双主题自动适配，零网络依赖） */
  .profile-page {
    background:
      radial-gradient(ellipse 70% 55% at 50% 0%, var(--amber-glow), transparent 70%),
      radial-gradient(ellipse 90% 65% at 50% 115%, var(--amber-glow), transparent 75%), var(--bg-deep);
  }
}
.profile-wrap {
  max-width: 720px;
  margin: 0 auto;
}
.empty {
  padding: 40px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9rem;
}

/* 信息卡 */
.profile-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 24px 20px;
}
@media (min-width: 768px) {
  .profile-card {
    background: rgba(26, 31, 38, 0.85);
    padding: 32px;
  }
  :root.light-theme .profile-card {
    background: var(--bg-card);
  }
}
.profile-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.avatar {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: linear-gradient(135deg, var(--amber-dim), var(--amber));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2rem;
  font-weight: 700;
  color: var(--bg-deep);
  border: 2px solid var(--border-subtle);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.profile-info {
  flex: 1;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.display-name {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}
.role-badge {
  padding: 1px 8px;
  border-radius: var(--radius-sm);
  font-size: 0.65rem;
  font-weight: 600;
  background: var(--border-subtle);
  color: var(--text-secondary);
}
.role-badge.creator {
  background: var(--amber-glow);
  color: var(--amber);
}
.role-badge.admin {
  background: rgba(196, 75, 75, 0.15);
  color: var(--red);
}
.username {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 2px;
}
.bio {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-top: 8px;
  line-height: 1.6;
}
.join-date {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-top: 8px;
}

/* 编辑 / 关注按钮 */
.edit-btn {
  flex-shrink: 0;
  align-self: flex-start;
  padding: 5px 16px;
  border-radius: 20px;
  font-size: 0.78rem;
  font-weight: 600;
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  text-decoration: none;
  font-family: inherit;
  transition: all var(--transition-fast);
}
.edit-btn:hover {
  border-color: var(--amber);
  color: var(--amber);
}
.follow-btn {
  flex-shrink: 0;
  align-self: flex-start;
  padding: 5px 16px;
  border-radius: 20px;
  font-size: 0.78rem;
  font-weight: 600;
  background: var(--amber);
  color: var(--on-amber);
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}
.follow-btn:hover {
  background: var(--amber-dim);
}
.follow-btn.followed {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
}
.follow-btn.followed:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

/* 统计条 */
.stats-row {
  display: flex;
  margin-top: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 16px 0;
}
@media (min-width: 768px) {
  .stats-row {
    background: rgba(26, 31, 38, 0.85);
  }
  :root.light-theme .stats-row {
    background: var(--bg-card);
  }
}
.stat {
  flex: 1;
  text-align: center;
}
.stat + .stat {
  border-left: 1px solid var(--border-subtle);
}
.stat-num {
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--amber);
}
.stat-label {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-top: 2px;
}

/* 文章列表 */
.posts-section {
  margin-top: 16px;
}
.section-title {
  font-family: var(--font-display);
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 10px;
  padding-left: 4px;
}
.post-item {
  display: flex;
  gap: 12px;
  align-items: center;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 12px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.post-item:hover {
  border-color: rgba(232, 168, 56, 0.35);
}
@media (min-width: 768px) {
  .post-item {
    background: rgba(26, 31, 38, 0.85);
  }
  :root.light-theme .post-item {
    background: var(--bg-card);
  }
}
.post-cover {
  width: 110px;
  aspect-ratio: 16/9;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  background: linear-gradient(135deg, #1a1f2e, #252b3a);
  display: flex;
  align-items: center;
  justify-content: center;
}
.post-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-placeholder {
  font-size: 1.3rem;
  opacity: 0.4;
}
.post-body {
  flex: 1;
  min-width: 0;
}
.post-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.post-badges {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.badge {
  padding: 1px 8px;
  border-radius: var(--radius-sm);
  font-size: 0.62rem;
  font-weight: 600;
}
.badge-game {
  background: var(--amber-glow);
  color: var(--amber);
}
.badge-cat {
  background: var(--border-subtle);
  color: var(--text-secondary);
}
.post-stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 0.68rem;
  color: var(--text-muted);
  margin-top: 6px;
}
.post-time {
  margin-left: auto;
}
.load-more {
  width: 100%;
  padding: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition-fast);
}
.load-more:hover:not(:disabled) {
  border-color: var(--amber);
  color: var(--amber);
}
.load-more:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
