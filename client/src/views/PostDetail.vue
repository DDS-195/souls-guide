<script setup lang="ts">
import { ref, reactive, provide, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { commentStateKey, type CommentState } from '../composables/commentState'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { postApi, interactApi } from '../api'
import PostBody from '../components/PostBody.vue'
import CommentItem from '../components/CommentItem.vue'
import { toast } from '../utils/toast'
import { errorMessage, errorStatus } from '../utils/errors'
import { getAnalyticsVisitorId } from '../utils/analytics'
import { historyKey } from '../utils/history'
import { copyText } from '../utils/clipboard'
import { animateComment, playFeedback } from '../utils/motion'
import { playArticleArrival } from '../utils/articleMotion'
import type { Comment, HistorySnapshot, Post } from '../types/api'
import AppPagination from '../components/AppPagination.vue'
import { usePagination } from '../composables/usePagination'
import MotionCount from '../components/MotionCount.vue'
import FollowLabel from '../components/FollowLabel.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const commentStates = reactive(new Map<number, CommentState>())
provide(commentStateKey, commentStates)
let statePostId = ''
const post = ref<Post | null>(null)
const articleTitle = ref<HTMLElement | null>(null)
const loadError = ref('')
const liked = ref(false)
const favorited = ref(false)
const likeIcon = ref<SVGElement | null>(null)
const favoriteIcon = ref<SVGElement | null>(null)
const comments = ref<Comment[]>([])
const animateComments = ref(false)
let commentMotionTimer: number | undefined
const commentText = ref('')
const followed = ref(false)
const avatarFailed = ref(false)
let viewTimer: number | null = null
const {
  page: commentPage,
  total: commentTotal,
  pageCount: commentPageCount,
  pageSize: commentPageSize,
  reset: resetComments,
  go: goCommentPage,
} = usePagination(20)

let detailSequence = 0
let commentsSequence = 0
const commentsLoading = ref(false)
const commentsError = ref('')
const busy = ref<Record<string, boolean>>({})
const statusReady = ref(false)
const statusLoading = ref(false)
const statusError = ref(false)
let viewReported = false
function scheduleView() {
  if (viewTimer !== null) window.clearTimeout(viewTimer)
  viewTimer = null
  if (!post.value || viewReported || document.visibilityState !== 'visible') return
  const id = post.value.id
  const seq = detailSequence
  viewTimer = window.setTimeout(async () => {
    if (seq !== detailSequence || document.visibilityState !== 'visible') return
    viewReported = true
    try {
      const result = await postApi.recordView(id, getAnalyticsVisitorId())
      if (seq === detailSequence && post.value?.id === id) post.value.view_count = result.data.view_count
    } catch { /* 统计失败不影响阅读，也不自动重复提交。 */ }
  }, 1500)
}
function login() { return router.push({ path: '/login', query: { redirect: route.fullPath } }) }
async function loadStatus(id: number, seq: number) {
  if (statusLoading.value) return
  statusLoading.value = true
  statusError.value = false
  try {
    if (!userStore.token) { statusReady.value = true; return }
    const res = await postApi.getStatus(id)
    if (seq !== detailSequence) return
    liked.value = res.data.liked
    favorited.value = res.data.favorited
    followed.value = res.data.is_followed
    statusReady.value = true
  } catch { if (seq === detailSequence) statusError.value = true }
  finally { if (seq === detailSequence) statusLoading.value = false }
}
async function loadDetail() {
  animateComments.value = false
  if (statePostId !== String(route.params.id)) {
    commentStates.clear()
    statePostId = String(route.params.id)
  }
  const seq = ++detailSequence
  viewReported = false
  ++commentsSequence
  if (viewTimer !== null) window.clearTimeout(viewTimer)
  post.value = null
  loadError.value = ''
  comments.value = []
  commentText.value = ''
  commentTotal.value = 0
  commentPage.value = 1
  liked.value = favorited.value = followed.value = false
  avatarFailed.value = false
  statusReady.value = false
  statusLoading.value = false
  statusError.value = false
  const id = +route.params.id
  const targetPage = Number(route.query.comment_page)
  if (Number.isSafeInteger(targetPage) && targetPage > 0) commentPage.value = targetPage
  try {
    const postRes = await postApi.getDetail(id)
    if (seq !== detailSequence) return
    post.value = postRes.data
    void loadStatus(id, seq)
    void loadComments(Number(route.query.comment_id)).then(async () => {
      if (seq !== detailSequence) return
      const targetComment = Number(route.query.comment_id)
      if (Number.isSafeInteger(targetComment) && targetComment > 0) {
        await nextTick()
        const element = document.getElementById('comment-' + targetComment)
        if (element) {
          element.scrollIntoView({ block: 'center' })
          element.focus({ preventScroll: true })
        } else if (!commentsError.value) toast('评论位置已变化或暂不可定位，请在评论区查看', 'info')
      }
    })
    // 内容成功渲染并停留后再上报有效阅读；详情 GET 本身不再产生统计副作用。
    await nextTick()
    if (seq !== detailSequence) return
    playArticleArrival(id, articleTitle.value)
    scheduleView()
  } catch (error: unknown) {
    // 文章不存在（404）/网络错误：显示错误态而非永久白屏（原实现无 catch）
    if (seq !== detailSequence) return
    loadError.value = errorStatus(error) === 404 ? '文章不存在或已被删除' : '加载失败，请检查网络后重试'
    return
  }
}
function recordHistory() {
  const d = post.value
  if (!d || (userStore.token && !userStore.userInfo?.id)) return
  const id = d.id
  const historyAccount = userStore.userInfo?.id
  // 登录资料尚未恢复时不写游客历史，恢复后由 watcher 补记。
  try {
    const raw = localStorage.getItem(historyKey(historyAccount))
    const history = (raw ? JSON.parse(raw) : []) as HistorySnapshot[]
    const filtered = history.filter((item) => item.id !== id)
    // 历史卡片化（2026-08-09 用户批准方案）：存卡片字段快照（不含 content），供历史页渲染兜底；
    // 头像/封面等实时数据由历史页用 GET /posts?ids= 批量补齐（发布者换头像后仍显示当前头像）
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
      username: d.username || '匿名',
      user_id: d.user_id,
      avatar: d.avatar || null,
    })
    localStorage.setItem(historyKey(historyAccount), JSON.stringify(filtered.slice(0, 50)))
  } catch {
    /* 历史写入失败不影响详情展示 */
  }
}
watch(() => [post.value?.id, userStore.userInfo?.id, userStore.token], recordHistory)
watch(() => [route.params.id, route.query.comment_page, route.query.comment_id], loadDetail, { immediate: true })

async function loadComments(focus?: number) {
  if (!post.value) return
  const seq = ++commentsSequence
  const id = post.value.id
  commentsLoading.value = true
  commentsError.value = ''
  try {
    const r = await postApi.getComments(id, { page: commentPage.value, pageSize: commentPageSize, focus_id: focus && Number.isSafeInteger(focus) && focus > 0 ? focus : undefined })
    if (seq !== commentsSequence || post.value?.id !== id) return
    commentTotal.value = r.data.total
    commentPage.value = r.data.page
    if (commentPage.value > commentPageCount.value) {
      commentPage.value = commentPageCount.value
      await loadComments()
      return
    }
    comments.value = r.data.list
  } catch (e) {
    if (seq === commentsSequence) commentsError.value = errorMessage(e, '评论加载失败，请重试')
  } finally { if (seq === commentsSequence) commentsLoading.value = false }
}
async function runAction(key: string, action: (id: number) => Promise<void>) {
  if (!userStore.token) { await login(); return }
  if (!post.value || busy.value[key]) return
  busy.value[key] = true
  try { await action(post.value.id) }
  catch (e) { toast(errorMessage(e, '操作失败，请重试'), 'error') }
  finally { busy.value[key] = false }
}
async function refreshCommentsWithMotion(focus?: number) {
  animateComments.value = true
  window.clearTimeout(commentMotionTimer)
  try { await loadComments(focus) }
  finally {
    await nextTick()
    commentMotionTimer = window.setTimeout(() => { animateComments.value = false }, 350)
  }
}
async function replyToComment(commentId: number, content: string, done: (ok: boolean) => void) {
  let success = false
  await runAction('reply-' + commentId, async (id) => {
    const result = await postApi.replyComment(commentId, content)
    success = true
    done(true)
    if (post.value?.id !== id) return
    post.value.comment_count += 1
    await refreshCommentsWithMotion(result.data.id)
    if (post.value?.id === id) toast('回复已发送', 'success')
  })
  if (!success) done(false)
}

async function toggleLike() {
  await runAction('like', async id => {
    const res = await postApi.like(id)
    if (post.value?.id !== id) return
    liked.value = res.data.liked
    post.value.like_count = res.data.like_count
    if (res.data.liked) playFeedback(likeIcon.value, 'confirm')
  })
}
async function toggleFav() {
  await runAction('favorite', async id => {
    const res = await postApi.favorite(id)
    if (post.value?.id !== id) return
    favorited.value = res.data.favorited
    post.value.favorite_count = res.data.favorite_count
    if (res.data.favorited) playFeedback(favoriteIcon.value, 'confirm')
  })
}
async function toggleFollow() {
  await runAction('follow', async id => {
    const res = await interactApi.follow(post.value!.user_id)
    if (post.value?.id === id) followed.value = res.data.following
  })
}
async function submitComment() {
  if (!userStore.token) { await login(); return }
  const content = commentText.value.trim()
  if (!content) return
  await runAction('comment', async id => {
    const result = await postApi.addComment(id, { content })
    if (post.value?.id !== id) return
    if (commentText.value.trim() === content) commentText.value = ''
    post.value.comment_count += 1
    resetComments()
    await refreshCommentsWithMotion(result.data.id)
  })
}
function focusComments() {
  document.querySelector<HTMLInputElement>('.comment-input-wrap input')?.focus()
  document.querySelector('.comments-section')?.scrollIntoView({ block: 'start' })
}
function changeCommentPage(n: number) { if (goCommentPage(n)) void loadComments() }
async function deleteComment(commentId: number) {
  if (!window.confirm('确认删除这条评论及其回复吗？')) return
  await runAction('delete-' + commentId, async id => {
    const result = await postApi.deleteComment(commentId)
    if (post.value?.id !== id) return
    post.value.comment_count = result.data.comment_count
    await refreshCommentsWithMotion()
    toast('评论已删除', 'success')
  })
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
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('visibilitychange', scheduleView)
})
onUnmounted(() => {
  window.clearTimeout(commentMotionTimer)
  ++detailSequence
  ++commentsSequence
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('visibilitychange', scheduleView)
  if (viewTimer !== null) window.clearTimeout(viewTimer)
})

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
    await copyText(url)
    toast('链接已复制，快去分享吧', 'success')
  } catch {
    toast('复制失败，请手动复制地址栏链接', 'error')
  } finally {
    menuOpen.value = false
  }
}

async function submitReport() {
  if (!reportType.value) return toast('请选择举报类型', 'error')
  if (!reportReason.value.trim()) return toast('请填写举报原因', 'error')
  if (!userStore.token) return router.push({ path: '/login', query: { redirect: route.fullPath } })
  if (!post.value) return
  await runAction('report', async id => {
    // 类型以 [类型] 前缀合入 reason 提交（reports 表冻结，不加列，R4）
    await interactApi.report({
      target_type: 'post',
      target_id: id,
      reason: `[${reportType.value}] ${reportReason.value.trim()}`,
    })
    toast('举报已提交，感谢你的反馈', 'success')
    if (post.value?.id !== id) return
    reportType.value = ''
    reportReason.value = ''
    reporting.value = false
    menuOpen.value = false
  })
}
</script>

<template>
  <div v-if="post" class="detail-page">
    <!-- 正文区 -->
    <div class="content-wrapper">
      <div class="content-area">
        <!-- 右上角「...」菜单：举报 -->
        <!-- @click.stop：菜单内部的点击不冒泡到 document，避免 onDocClick 误关（2026-08-08 修复） -->
        <div ref="menuRef" class="post-menu" @click.stop @keydown.esc.stop="menuOpen = false; reporting = false">
          <button type="button" class="more-btn" aria-label="更多文章操作" :aria-expanded="menuOpen" :class="{ active: menuOpen }" @click="toggleMenu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="5" r="1.2" />
              <circle cx="12" cy="12" r="1.2" />
              <circle cx="12" cy="19" r="1.2" />
            </svg>
          </button>
          <Transition name="anchored-menu">
          <div v-if="menuOpen" class="more-dropdown" :class="{ wide: reporting }">
            <template v-if="!reporting">
              <button type="button" class="more-item" @click="sharePost">🔗 分享</button>
              <button type="button" class="more-item" @click="openReport">🚩 举报</button>
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
                <button class="more-action-btn primary" :disabled="busy.report" @click="submitReport">{{ busy.report ? '提交中…' : '提交举报' }}</button>
                <button class="more-action-btn" @click="reporting = false">取消</button>
              </div>
            </template>
          </div>
          </Transition>
        </div>
        <span class="tag tag-game">{{ post.game_name || post.game_id }}</span>
        <span class="tag tag-cat">{{ post.category }}</span>
        <h1 ref="articleTitle" data-article-title class="title">{{ post.title }}</h1>
        <!-- 作者信息区：头像 + 昵称（可点击进主页）+ 浏览/时间 + 关注按钮 -->
        <div class="author-bar">
          <router-link :to="`/user/${post.user_id}`" class="author-link">
            <div class="author-avatar">
              <img v-if="post.avatar && !avatarFailed" :src="post.avatar" alt="作者头像" @error="avatarFailed = true" />
              <span v-else>{{ (post.username || 'U').charAt(0) }}</span>
            </div>
            <div class="author-info">
              <div class="author-name">{{ post.nickname || post.username }}</div>
              <div class="meta">
                <span>👁 {{ post.view_count }} 浏览</span>
                <span>{{ new Date(post.published_at || post.created_at || '').toLocaleDateString('zh-CN') }}</span>
              </div>
            </div>
          </router-link>
          <button
            v-if="post.user_id !== userStore.userInfo?.id"
            class="follow-btn" :disabled="busy.follow || !statusReady"
            :class="{ followed }"
            @click="toggleFollow"
          >
            <FollowLabel :followed="followed" />
          </button>
        </div>
        <PostBody :post="post" reading-tools />

        <p v-if="statusError"><button :disabled="statusLoading" @click="loadStatus(post.id, detailSequence)">互动状态加载失败，点击重试</button></p>
        <div class="comments-section" :aria-busy="commentsLoading">
          <p v-if="commentsLoading">评论加载中…</p>
          <p v-if="commentsError">{{ commentsError }} <button @click="loadComments()">重试</button></p>
          <div v-if="!commentsLoading && !commentsError && !comments.length" class="comments-empty">暂无评论，来说两句吧</div>
          <TransitionGroup tag="div" class="comment-list" :css="false" @enter="(el, done) => animateComment(el, done, animateComments)" @leave="(el, done) => animateComment(el, done, animateComments, true)">
          <CommentItem
            v-for="c in comments"
            :key="c.id"
            :comment="c"
            :current-user-id="userStore.userInfo?.id"
            :is-admin="userStore.role === 'admin'"
            :animate-changes="animateComments"
            @reply="replyToComment"
            @delete="deleteComment"
          />
          </TransitionGroup>
          <AppPagination :page="commentPage" :page-count="commentPageCount" @change="changeCommentPage" />
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div class="bottombar">
      <div class="comment-input-wrap">
        <input v-model="commentText" maxlength="2000" :disabled="busy.comment" placeholder="说点什么..." @keyup.enter="submitComment" />
        <button class="send-btn" :disabled="busy.comment" @click="submitComment">发送</button>
      </div>
      <div class="actions">
        <button aria-label="点赞" :disabled="busy.like || !statusReady" class="action-item" :class="{ active: liked }" @click="toggleLike">
          <svg ref="likeIcon" class="interaction-icon heart-icon" :class="{ selected: liked }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg>
          <MotionCount class="action-num" :value="post.like_count" />
        </button>
        <button aria-label="收藏" :disabled="busy.favorite || !statusReady" class="action-item" :class="{ active: favorited }" @click="toggleFav">
          <svg ref="favoriteIcon" class="interaction-icon bookmark-icon" :class="{ selected: favorited }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z" /></svg>
          <MotionCount class="action-num" :value="post.favorite_count || 0" />
        </button>
        <button aria-label="查看评论" class="action-item" @click="focusComments">
          <svg class="interaction-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10Z" /></svg>
          <MotionCount class="action-num" :value="post.comment_count" />
        </button>
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
    <button @click="loadDetail">重新加载</button>
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
  <div v-else role="status" style="padding: 60px; text-align: center">文章加载中…</div>
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
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: none;
  font-family: inherit;
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
