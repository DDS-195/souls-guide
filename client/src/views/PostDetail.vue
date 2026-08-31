<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { postApi, interactApi } from '../api'
import PostBody from '../components/PostBody.vue'
import { toast } from '../utils/toast'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const post = ref<any>(null)
const loadError = ref('')
const liked = ref(false)
const favorited = ref(false)
const comments = ref<any[]>([])
const commentText = ref('')
const followed = ref(false)
const avatarFailed = ref(false)
const commentAvatarFailed = ref<Set<number>>(new Set())

onMounted(async () => {
  const id = +route.params.id
  try {
    const promises: any[] = [postApi.getDetail(id), postApi.getComments(id)]
    if (userStore.token)
      promises.push(
        postApi.getStatus(id).catch(() => ({ data: { liked: false, favorited: false, is_followed: false } })),
      )
    const [postRes, commentRes, statusRes] = await Promise.all(promises)
    post.value = postRes.data
    comments.value = commentRes.data
    if (statusRes) {
      liked.value = statusRes.data.liked
      favorited.value = statusRes.data.favorited
      followed.value = statusRes.data.is_followed
    }
  } catch (e: any) {
    // 文章不存在（404）/网络错误：显示错误态而非永久白屏（原实现无 catch）
    loadError.value = e?.response?.status === 404 ? '文章不存在或已被删除' : '加载失败，请检查网络后重试'
    return
  }
  // 浏览历史快照写入：localStorage 可能被外部损坏（JSON 解析失败），写入失败不影响详情展示
  try {
    const raw = localStorage.getItem('viewHistory')
    const history = raw ? JSON.parse(raw) : []
    const filtered = history.filter((h: any) => h.id !== id)
    // 历史卡片化（2026-08-09 用户批准方案）：存卡片字段快照（不含 content），供历史页渲染兜底；
    // 头像/封面等实时数据由历史页用 GET /posts?ids= 批量补齐（发布者换头像后仍显示当前头像）
    const d = post.value
    filtered.unshift({
      id,
      title: d.title,
      time: new Date().toLocaleString(),
      cover: d.cover,
      game_id: d.game_id,
      game_name: d.game_name,
      category: d.category,
      tags: d.tags || [],
      view_count: d.view_count,
      like_count: d.like_count,
      comment_count: d.comment_count,
      username: d.username,
      user_id: d.user_id,
      avatar: d.avatar,
    })
    localStorage.setItem('viewHistory', JSON.stringify(filtered.slice(0, 50)))
  } catch {
    /* 历史写入失败不影响详情展示 */
  }
})

/** 统计嵌套评论树节点总数（评论 + 全部回复）——与后端 comment_count 语义一致（addComment 对回复同样 +1） */
function countTree(list: any[]): number {
  return list.reduce((n, c) => n + 1 + countTree(c.replies || []), 0)
}

async function toggleLike() {
  if (!userStore.token) return router.push('/login')
  const res: any = await postApi.like(post.value.id)
  liked.value = res.data.liked
  post.value.like_count += liked.value ? 1 : -1
}
async function toggleFav() {
  if (!userStore.token) return router.push('/login')
  const res: any = await postApi.favorite(post.value.id)
  favorited.value = res.data.favorited
}
/** 关注/取消关注（POST /follows/:id 为 toggle，返回 following） */
async function toggleFollow() {
  if (!userStore.token) return router.push('/login')
  const res: any = await interactApi.follow(post.value.user_id)
  followed.value = res.data.following
}

async function submitComment() {
  if (!commentText.value.trim() || !userStore.token) return
  await postApi.addComment(post.value.id, { content: commentText.value })
  commentText.value = ''
  const r = await postApi.getComments(post.value.id)
  comments.value = r.data
  post.value.comment_count = countTree(comments.value)
}

/* —— 正文右上角「...」菜单：举报（2026-08-08 新增，契约 POST /api/reports） —— */
const menuOpen = ref(false)
const reporting = ref(false)
const reportType = ref('')
const reportReason = ref('')
const reportTypes = ['广告营销', '色情低俗', '谩骂攻击', '虚假信息', '侵权盗用', '其他']
const menuRef = ref<HTMLElement | null>(null)

// 点击菜单外部任意处关闭（菜单内部点击已被 @click.stop 截停，不会走到这里）
function onDocClick(e: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
    menuOpen.value = false
    reporting.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function openReport() {
  reporting.value = true
}

// 分享：复制当前文章页链接（2026-08-08 新增，纯前端功能）
// 链接 = 地址栏当前完整 URL（协议+域名/IP+端口+部署子路径+路由），与浏览器地址栏 100% 一致；
// 项目部署上线后自动跟随公网环境，不写死任何固定地址
async function sharePost() {
  const url = window.location.href
  try {
    await navigator.clipboard.writeText(url)
    toast('链接已复制，快去分享吧', 'success')
  } catch {
    // 兜底（非 HTTPS 环境等）：textarea + execCommand
    const ta = document.createElement('textarea')
    ta.value = url
    ta.style.cssText = 'position:fixed;opacity:0;'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    toast('链接已复制，快去分享吧', 'success')
  } finally {
    menuOpen.value = false
  }
}

async function submitReport() {
  if (!reportType.value) return toast('请选择举报类型', 'error')
  if (!reportReason.value.trim()) return toast('请填写举报原因', 'error')
  if (!userStore.token) return router.push({ path: '/login', query: { redirect: route.fullPath } })
  try {
    // 类型以 [类型] 前缀合入 reason 提交（reports 表冻结，不加列，R4）
    await interactApi.report({
      target_type: 'post',
      target_id: post.value.id,
      reason: `[${reportType.value}] ${reportReason.value.trim()}`,
    })
    toast('举报已提交，感谢你的反馈', 'success')
    reportType.value = ''
    reportReason.value = ''
    reporting.value = false
    menuOpen.value = false
  } catch (e: any) {
    toast(e?.response?.data?.message || '提交失败，请稍后重试', 'error')
  }
}
</script>

<template>
  <div v-if="post" class="detail-page">
    <!-- 正文区 -->
    <div class="content-wrapper">
      <div class="content-area">
        <!-- 右上角「...」菜单：举报 -->
        <!-- @click.stop：菜单内部的点击不冒泡到 document，避免 onDocClick 误关（2026-08-08 修复） -->
        <div ref="menuRef" class="post-menu" @click.stop>
          <button class="more-btn" :class="{ active: menuOpen }" @click="toggleMenu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="5" r="1.2" />
              <circle cx="12" cy="12" r="1.2" />
              <circle cx="12" cy="19" r="1.2" />
            </svg>
          </button>
          <div v-if="menuOpen" class="more-dropdown" :class="{ wide: reporting }">
            <template v-if="!reporting">
              <div class="more-item" @click="sharePost">🔗 分享</div>
              <div class="more-item" @click="openReport">🚩 举报</div>
            </template>
            <template v-else>
              <div class="report-panel-title">举报类型</div>
              <div class="report-types">
                <label v-for="t in reportTypes" :key="t" class="report-type" :class="{ selected: reportType === t }">
                  <input v-model="reportType" type="radio" :value="t" hidden />
                  <span>{{ t }}</span>
                </label>
              </div>
              <div class="report-panel-title">举报原因</div>
              <textarea
                v-model="reportReason"
                class="report-input"
                rows="3"
                placeholder="请描述具体原因（必填）"
                @click.stop
              />
              <div class="more-actions">
                <button class="more-action-btn primary" @click="submitReport">提交举报</button>
                <button class="more-action-btn" @click="reporting = false">取消</button>
              </div>
            </template>
          </div>
        </div>
        <span class="tag tag-game">{{ post.game_name || post.game_id }}</span>
        <span class="tag tag-cat">{{ post.category }}</span>
        <h1 class="title">{{ post.title }}</h1>
        <!-- 作者信息区：头像 + 昵称（可点击进主页）+ 浏览/时间 + 关注按钮 -->
        <div class="author-bar">
          <router-link :to="`/user/${post.user_id}`" class="author-link">
            <div class="author-avatar">
              <img v-if="post.avatar && !avatarFailed" :src="post.avatar" alt="作者头像" @error="avatarFailed = true" />
              <span v-else>{{ (post.username || 'U').charAt(0) }}</span>
            </div>
            <div class="author-info">
              <div class="author-name">{{ post.username }}</div>
              <div class="meta">
                <span>👁 {{ post.view_count }} 浏览</span>
                <span>{{ post.created_at?.slice(0, 10) }}</span>
              </div>
            </div>
          </router-link>
          <button
            v-if="post.user_id !== userStore.userInfo?.id"
            class="follow-btn"
            :class="{ followed }"
            @click="toggleFollow"
          >
            {{ followed ? '已关注' : '关注' }}
          </button>
        </div>
        <PostBody :post="post" />

        <div class="comments-section">
          <div v-if="!comments.length" class="comments-empty">暂无评论，来说两句吧</div>
          <div v-for="c in comments" :key="c.id" class="comment-item">
            <router-link v-if="c.user_id" :to="`/user/${c.user_id}`" class="comment-avatar">
              <img
                v-if="c.avatar && !commentAvatarFailed.has(c.id)"
                :src="c.avatar"
                alt="评论者头像"
                @error="commentAvatarFailed = new Set(commentAvatarFailed).add(c.id)"
              />
              <span v-else>{{ (c.nickname || c.username || '?').charAt(0) }}</span>
            </router-link>
            <div v-else class="comment-avatar">
              <img
                v-if="c.avatar && !commentAvatarFailed.has(c.id)"
                :src="c.avatar"
                alt="评论者头像"
                @error="commentAvatarFailed = new Set(commentAvatarFailed).add(c.id)"
              />
              <span v-else>{{ (c.nickname || c.username || '?').charAt(0) }}</span>
            </div>
            <div class="comment-body">
              <div class="comment-meta">
                <router-link v-if="c.user_id" :to="`/user/${c.user_id}`" class="comment-name">{{
                  c.nickname || c.username
                }}</router-link>
                <span v-else class="comment-name">{{ c.nickname || c.username }}</span>
                <span class="comment-time">{{ c.created_at?.slice(0, 10) }}</span>
              </div>
              <div class="comment-content">{{ c.content }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div class="bottombar">
      <div class="comment-input-wrap">
        <input v-model="commentText" placeholder="说点什么..." @keyup.enter="submitComment" />
        <span class="send-btn" @click="submitComment">发送</span>
      </div>
      <div class="actions">
        <div class="action-item" :class="{ active: liked }" @click="toggleLike">
          <span style="font-size: 1.3rem">{{ liked ? '❤️' : '🤍' }}</span>
          <span class="action-num">{{ post.like_count }}</span>
        </div>
        <div class="action-item" :class="{ active: favorited }" @click="toggleFav">
          <span style="font-size: 1.3rem">{{ favorited ? '⭐' : '☆' }}</span>
        </div>
        <div class="action-item">
          <span style="font-size: 1.3rem">💬</span>
          <span class="action-num">{{ post.comment_count }}</span>
        </div>
      </div>
    </div>
  </div>

  <div
    v-else-if="loadError"
    style="
      min-height: 60vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      color: var(--text-muted);
    "
  >
    <div style="font-size: 3rem; opacity: 0.2">🗡️</div>
    <div>{{ loadError }}</div>
    <button
      style="
        padding: 8px 24px;
        background: var(--amber);
        border: none;
        border-radius: 20px;
        color: var(--on-amber);
        cursor: pointer;
        font-weight: 600;
        font-size: 0.85rem;
        font-family: inherit;
      "
      @click="router.push('/')"
    >
      返回首页
    </button>
  </div>
</template>

<style scoped>
.detail-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-deep);
}
@media (min-width: 768px) {
  /* 桌面端氛围背景：篝火光晕渐变（原为外链 Unsplash 图片，国内加载不稳定/失败，
     改为纯 CSS 多层 radial-gradient，颜色走设计变量、双主题自动适配，零网络依赖） */
  .detail-page {
    background:
      radial-gradient(ellipse 70% 55% at 50% 0%, var(--amber-glow), transparent 70%),
      radial-gradient(ellipse 90% 65% at 50% 115%, var(--amber-glow), transparent 75%), var(--bg-deep);
  }
}
.tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 0.65rem;
  font-weight: 600;
}
.tag-game {
  background: var(--amber-glow);
  color: var(--amber);
}
.tag-cat {
  background: var(--border-subtle);
  color: var(--text-secondary);
  margin-left: 6px;
}
.title {
  font-family: var(--font-display);
  font-size: 1.4rem;
  color: var(--amber);
  margin: 10px 0 12px;
  line-height: 1.4;
  padding-right: 48px;
}

/* 正文右上角「...」菜单（举报） */
.post-menu {
  position: absolute;
  top: 4px;
  right: 8px;
  z-index: 20;
}
.more-btn {
  padding: 4px 6px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color var(--transition-fast);
}
.more-btn:hover {
  color: var(--text-primary);
}
.more-btn.active {
  color: var(--amber);
}
.more-btn svg {
  width: 20px;
  height: 20px;
}
.more-dropdown {
  position: absolute;
  top: 40px;
  right: 0;
  min-width: 150px; /* 菜单态窄版（分享/举报两行）；举报面板态加 .wide 恢复 240px */
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  padding: 6px;
  z-index: 30;
}
.more-dropdown.wide {
  min-width: 240px;
}
.more-item {
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  color: var(--red);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.more-item:hover {
  background: var(--bg-hover);
}
.report-panel-title {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-weight: 600;
  margin: 8px 4px 6px;
}
.report-types {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 2px;
}
.report-type {
  padding: 5px 12px;
  border-radius: 14px;
  font-size: 0.76rem;
  cursor: pointer;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}
.report-type:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}
.report-type.selected {
  background: var(--amber-glow);
  border-color: var(--amber);
  color: var(--amber);
}
.report-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  background: var(--bg-sidebar);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 0.8rem;
  font-family: inherit;
  resize: vertical;
  outline: none;
}
.report-input:focus {
  border-color: var(--amber);
}
.more-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.more-action-btn {
  flex: 1;
  padding: 7px 0;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 0.78rem;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}
.more-action-btn:hover {
  color: var(--text-primary);
}
.more-action-btn.primary {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--on-amber);
  font-weight: 600;
}
.more-action-btn.primary:hover {
  background: var(--amber-dim);
  color: var(--on-amber);
}
.author-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}
.author-link {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  text-decoration: none;
  transition: opacity var(--transition-fast);
}
.author-link:hover .author-name {
  color: var(--amber);
}
.author-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: linear-gradient(135deg, var(--amber-dim), var(--amber));
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 0.85rem;
  color: var(--bg-deep);
}
.author-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.author-info {
  flex: 1;
  min-width: 0;
}
.author-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}
.meta {
  display: flex;
  gap: 14px;
  color: var(--text-muted);
  font-size: 0.72rem;
  margin-top: 2px;
}
.follow-btn {
  padding: 5px 16px;
  border-radius: 20px;
  font-size: 0.78rem;
  font-weight: 600;
  background: var(--amber);
  color: var(--on-amber);
  border: none;
  cursor: pointer;
  flex-shrink: 0;
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

/* 评论区 */
.comments-section {
  margin-top: 24px;
  border-top: 1px solid var(--border-subtle);
  padding-top: 16px;
}
.comments-empty {
  color: var(--text-muted);
  text-align: center;
  padding: 30px;
  font-size: 0.9rem;
}
.comment-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  gap: 10px;
}
.comment-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: linear-gradient(135deg, var(--amber-dim), var(--amber));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--bg-deep);
  text-decoration: none;
  transition: opacity var(--transition-fast);
}
.comment-avatar:hover {
  opacity: 0.85;
}
.comment-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.comment-body {
  flex: 1;
  min-width: 0;
}
.comment-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.comment-name {
  font-weight: 600;
  font-size: 0.82rem;
  color: var(--text-primary);
  text-decoration: none;
  transition: color var(--transition-fast);
}
a.comment-name:hover {
  color: var(--amber);
}
.comment-time {
  font-size: 0.65rem;
  color: var(--text-muted);
}
.comment-content {
  font-size: 0.8rem;
  margin-top: 2px;
  color: var(--text-primary);
  line-height: 1.6;
}
.content-wrapper {
  flex: 1;
  padding: 0;
}
@media (min-width: 768px) {
  .content-wrapper {
    padding: 24px 0 40px;
  }
}
.content-area {
  position: relative;
  flex: 1;
  padding: 16px 16px calc(112px + env(safe-area-inset-bottom));
  max-width: 100%;
  margin: 0 auto;
  background: var(--bg-card); /* 卡片背景延伸到底栏上方：底部让位内移，文档流末端无页面留白 */
}
@media (min-width: 768px) {
  .content-area {
    max-width: 720px;
    margin: 0 auto;
    width: 100%;
    background: rgba(10, 14, 20, 0.85);
    border-radius: var(--radius-lg);
    padding: 28px 32px 120px;
    border: 1px solid var(--border-subtle);
  }
}
/* 底栏：手机端贴底通栏（直角、分割线）；PC 端悬浮圆角矩形，与正文列等宽居中 */
.bottombar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border-subtle);
  padding: 8px 14px calc(8px + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  gap: 0;
  z-index: 10;
}
@media (min-width: 768px) {
  .bottombar {
    bottom: 16px;
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    width: 720px;
    max-width: calc(100% - 32px);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    padding: 10px 16px;
  }
  :root.light-theme .bottombar {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  }
}
.comment-input-wrap {
  flex: 7;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-card);
  border-radius: 20px;
  padding: 8px 14px;
  min-width: 0;
}
.comment-input-wrap input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.85rem;
  font-family: inherit;
  min-width: 0;
}
.comment-input-wrap input::placeholder {
  color: var(--text-muted);
}
.send-btn {
  color: var(--amber);
  font-size: 0.85rem;
  cursor: pointer;
  flex-shrink: 0;
}
.actions {
  flex: 3;
  display: flex;
  justify-content: space-around;
  flex-shrink: 0;
  min-width: 0;
}
.action-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  transition: color var(--transition-fast);
}
.action-item:hover {
  color: var(--text-primary);
}
.action-item:hover .action-num {
  color: var(--amber);
}
.action-num {
  font-size: 0.65rem;
  color: var(--text-muted);
  margin-top: 1px;
}
.action-item.active .action-num {
  color: var(--amber);
}
</style>
