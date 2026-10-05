<script setup lang="ts">
import { ref, reactive, inject, toRefs, computed, watch, onUnmounted } from 'vue'
import { commentStateKey, type CommentState } from '../composables/commentState'
import { postApi } from '../api'
import { errorMessage } from '../utils/errors'
import type { Comment } from '../types/api'
import ExpandPanel from './ExpandPanel.vue'
import { animateComment } from '../utils/motion'

defineOptions({ name: 'CommentItem' })

const props = withDefaults(
  defineProps<{
    comment: Comment
    currentUserId?: number
    isAdmin?: boolean
    depth?: number
    animateChanges?: boolean
  }>(),
  { currentUserId: undefined, isAdmin: false, depth: 0, animateChanges: false },
)

const emit = defineEmits<{
  (e: 'reply', commentId: number, content: string, done: (ok: boolean) => void): void
  (e: 'delete', commentId: number): void
}>()

const states = inject(commentStateKey, new Map<number, CommentState>())
if (!states.has(props.comment.id)) states.set(props.comment.id, reactive({ replying: false, replyText: '', replyPage: 0, loadedReplies: [], replyTotal: 0, collapsed: false }))
const { replying, replyText, replyPage, loadedReplies, replyTotal, collapsed } = toRefs(states.get(props.comment.id)!)
const avatarFailed = ref(false)
const submitting = ref(false)
const repliesLoading = ref(false)
const repliesError = ref('')
let requestSequence = 0
const visibleReplies = computed(() => collapsed.value ? [] : replyPage.value ? loadedReplies.value : props.comment.replies || [])
const renderedReplies = computed(() => replyPage.value ? loadedReplies.value : props.comment.replies || [])
const totalReplies = computed(() => replyPage.value ? replyTotal.value : props.comment.reply_count ?? props.comment.replies.length)
const replyPages = computed(() => Math.max(1, Math.ceil(totalReplies.value / 10)))
watch(() => props.comment, () => {
  ++requestSequence
  repliesLoading.value = false
  repliesError.value = ''
  if (props.comment.focus_path || props.comment.replies.some(c => c.focus_path)) {
    replyPage.value = 0
    collapsed.value = false
  } else if (replyPage.value && !collapsed.value) void loadReplies(replyPage.value)
}, { immediate: true })
onUnmounted(() => { ++requestSequence })
async function loadReplies(page: number) {
  const seq = ++requestSequence
  repliesLoading.value = true
  repliesError.value = ''
  try {
    const res = await postApi.getComments(props.comment.post_id, { parent_id: props.comment.id, page, pageSize: 10 })
    if (seq !== requestSequence) return
    const last = Math.max(1, Math.ceil(res.data.total / 10))
    if (page > last) { await loadReplies(last); return }
    loadedReplies.value = res.data.list
    replyTotal.value = res.data.total
    replyPage.value = page
    collapsed.value = false
  } catch (e) {
    if (seq === requestSequence) repliesError.value = errorMessage(e, '回复加载失败，请重试')
  } finally { if (seq === requestSequence) repliesLoading.value = false }
}

function submitReply() {
  const content = replyText.value.trim()
  if (!content || submitting.value) return
  submitting.value = true
  emit('reply', props.comment.id, content, (ok) => {
    submitting.value = false
    if (ok) { replyText.value = ''; replying.value = false }
  })
}
</script>

<template>
  <div :id="'comment-' + comment.id" class="comment-item" tabindex="-1" :class="{ nested: depth > 0 }">
    <router-link v-if="comment.user_id" :to="`/user/${comment.user_id}`" class="comment-avatar">
      <img v-if="comment.avatar && !avatarFailed" :src="comment.avatar" alt="评论者头像" @error="avatarFailed = true" />
      <span v-else>{{ (comment.nickname || comment.username || '?').charAt(0) }}</span>
    </router-link>
    <div class="comment-main">
      <div class="comment-meta">
        <router-link v-if="comment.user_id" :to="`/user/${comment.user_id}`" class="comment-name">
          {{ comment.nickname || comment.username }}
        </router-link>
        <span class="comment-time">{{ comment.created_at?.slice(0, 10) }}</span>
      </div>
      <div v-if="!comment.user_id" class="comment-name">已注销用户</div>
      <div class="comment-content">{{ comment.is_deleted ? '[该评论已删除]' : comment.content }}</div>
      <div class="comment-actions">
        <button :aria-expanded="replying" @click="replying = !replying">{{ replying ? '取消回复' : '回复' }}</button>
        <button v-if="!comment.is_deleted && (isAdmin || currentUserId === comment.user_id)" class="danger" @click="$emit('delete', comment.id)">
          删除
        </button>
      </div>
      <ExpandPanel :open="replying">
      <div class="reply-form">
        <input v-model="replyText" :disabled="submitting" maxlength="2000" placeholder="回复这条评论…" @keyup.enter="submitReply" />
        <button :disabled="submitting || !replyText.trim()" @click="submitReply">{{ submitting ? '发送中…' : '发送' }}</button>
      </div>
      </ExpandPanel>
      <p v-if="repliesError" role="alert">{{ repliesError }} <button @click="loadReplies(replyPage || 1)">重试</button></p>
      <ExpandPanel :open="!collapsed && renderedReplies.length > 0">
      <TransitionGroup tag="div" class="replies" :aria-busy="repliesLoading" :css="false" @enter="(el, done) => animateComment(el, done, animateChanges)" @leave="(el, done) => animateComment(el, done, animateChanges, true)">
        <CommentItem
          v-for="reply in renderedReplies"
          :key="reply.id"
          :comment="reply"
          :current-user-id="currentUserId"
          :is-admin="isAdmin"
          :depth="depth + 1"
          :animate-changes="animateChanges"
          @reply="(id, content, done) => $emit('reply', id, content, done)"
          @delete="(id) => $emit('delete', id)"
        />
      </TransitionGroup>
      </ExpandPanel>
      <div v-if="totalReplies" class="reply-pagination">
        <button v-if="collapsed || (!replyPage && (totalReplies > visibleReplies.length || comment.focus_path))" :disabled="repliesLoading" @click="loadReplies(1)">查看回复（{{ totalReplies }}）</button>
        <template v-if="replyPage && !collapsed">
          <button :disabled="repliesLoading || replyPage <= 1" @click="loadReplies(replyPage - 1)">上一页</button>
          <span>{{ replyPage }} / {{ replyPages }}</span>
          <button :disabled="repliesLoading || replyPage >= replyPages" @click="loadReplies(replyPage + 1)">下一页</button>
        </template>
        <button v-if="!collapsed && visibleReplies.length" @click="collapsed = true">收起回复</button>
        <span v-if="repliesLoading" role="status">加载中…</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reply-pagination { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 10px; font-size: .75rem; color: var(--text-muted); }
.reply-pagination button { color: var(--cyan); font: inherit; }
.reply-pagination button:disabled { opacity: .4; cursor: default; }
.comment-item { display: flex; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--border-subtle); }
.comment-item.nested { margin-top: 10px; padding: 10px 0 0; border-top: 1px solid var(--border-subtle); border-bottom: 0; }
.comment-avatar { width: 34px; height: 34px; border-radius: 50%; overflow: hidden; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--bg-hover); color: var(--amber); text-decoration: none; }
.comment-avatar img { width: 100%; height: 100%; object-fit: cover; }
.comment-main { flex: 1; min-width: 0; }
.comment-meta { display: flex; align-items: center; gap: 8px; }
.comment-name { color: var(--text-primary); font-size: 0.82rem; font-weight: 600; text-decoration: none; }
.comment-time { color: var(--text-muted); font-size: 0.7rem; }
.comment-content { margin-top: 4px; color: var(--text-secondary); font-size: 0.86rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.comment-actions { display: flex; gap: 10px; margin-top: 5px; }
.comment-actions button { padding: 0; border: 0; background: none; color: var(--text-muted); cursor: pointer; font-size: 0.72rem; }
.comment-actions button:hover { color: var(--amber); }
.comment-actions .danger:hover { color: var(--red); }
.reply-form { display: flex; gap: 8px; margin-top: 8px; }
.reply-form input { flex: 1; min-width: 0; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--border-subtle); background: var(--bg-main); color: var(--text-primary); }
.reply-form button { padding: 6px 12px; border: 0; border-radius: 6px; background: var(--amber); color: var(--on-amber); cursor: pointer; }
.reply-form button:disabled { opacity: 0.5; cursor: not-allowed; }
.replies { margin-left: 4px; }
@media (max-width: 767px) { .comment-item.nested { margin-left: -24px; } }
</style>
