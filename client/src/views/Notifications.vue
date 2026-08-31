<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { interactApi } from '../api'
import { useUserStore } from '../stores/user'
import { toast } from '../utils/toast'

const router = useRouter()
const userStore = useUserStore()
const list = ref<any[]>([])
const loading = ref(true)
const tab = ref<'unread' | 'all'>('unread')
const detail = ref<any>(null)

const showList = computed(() => (tab.value === 'unread' ? list.value.filter((n) => !n.is_read) : list.value))

onMounted(async () => {
  try {
    const res = await interactApi.getNotifications({ pageSize: 50 })
    list.value = res.data.list
    userStore.unreadCount = res.data.unread || 0
  } finally {
    loading.value = false
  }
})

async function markAllRead() {
  try {
    await interactApi.markAllRead()
    userStore.unreadCount = 0
    list.value = list.value.map((n) => ({ ...n, is_read: 1 }))
  } catch {
    toast('操作失败，请重试', 'error')
  }
}

async function openDetail(n: any) {
  detail.value = n
  if (!n.is_read) {
    // 单条已读（不再全部已读；契约 PUT /notifications/:id/read）
    try {
      await interactApi.markRead(n.id)
    } catch {
      /* 标记失败不阻断展示 */
    }
    n.is_read = 1
    userStore.unreadCount = Math.max(0, userStore.unreadCount - 1)
  }
}

/** 通知跳转目标（设计文档 3.6：target_type+target_id 即跳转目标）。
 * 后端各类型落库情况：post → 文章；user → 用户主页（关注通知）；comment 的 target_id 是评论 id 而非文章 id
 * （后端未存 post_id，前端无法定位所属文章）；creatorship/system 无页面目标。 */
function targetRoute(n: any): string | null {
  if (n.target_type === 'post' && n.target_id) return `/post/${n.target_id}`
  if (n.target_type === 'user' && n.target_id) return `/user/${n.target_id}`
  return null
}

function goTarget() {
  const r = targetRoute(detail.value)
  if (!r) return
  detail.value = null
  router.push(r)
}
</script>

<template>
  <div style="padding: 20px 24px; color: var(--text-primary); max-width: 100%">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
      <h2 style="font-family: Cinzel, serif; color: var(--amber)">通知</h2>
    </div>

    <div style="display: flex; gap: 4px; margin-bottom: 20px">
      <button class="notify-tab" :class="{ active: tab === 'unread' }" @click="tab = 'unread'">
        未读{{ userStore.unreadCount ? ` (${userStore.unreadCount})` : '' }}
      </button>
      <button class="notify-tab" :class="{ active: tab === 'all' }" @click="tab = 'all'">全部</button>
      <button
        v-if="userStore.unreadCount"
        style="
          margin-left: auto;
          padding: 6px 14px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 0.8rem;
        "
        @click="markAllRead"
      >
        全部已读
      </button>
    </div>

    <div v-if="loading" style="text-align: center; color: var(--text-muted); padding: 60px">加载中...</div>

    <div v-else-if="!showList.length" style="text-align: center; padding: 80px 20px">
      <div style="font-size: 3rem; opacity: 0.2; margin-bottom: 12px">{{ tab === 'unread' ? '🎉' : '🔔' }}</div>
      <p style="color: var(--text-muted); font-size: 0.95rem">{{ tab === 'unread' ? '没有未读消息' : '暂无消息' }}</p>
      <p style="color: var(--text-muted); font-size: 0.8rem; margin-top: 4px">
        有人点赞、评论或关注你时，通知会出现在这里
      </p>
    </div>

    <div v-else style="display: flex; flex-direction: column; gap: 6px">
      <div
        v-for="n in showList"
        :key="n.id"
        :style="{
          padding: '14px 16px',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          cursor: 'pointer',
          background: n.is_read ? 'var(--bg-card)' : 'var(--bg-hover)',
          border: '1px solid ' + (n.is_read ? 'var(--border-subtle)' : 'rgba(232,168,56,0.15)'),
        }"
        @click="openDetail(n)"
      >
        <div
          :style="{
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            flexShrink: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '700',
            fontSize: '1rem',
            color: 'var(--bg-deep)',
            background: n.avatar
              ? `url(${n.avatar}) center/cover`
              : 'linear-gradient(135deg,var(--amber-dim),var(--amber))',
          }"
        >
          <span v-if="!n.avatar">{{ n.type === 'system' ? '系' : (n.nickname || n.username || '?').charAt(0) }}</span>
        </div>
        <div style="flex: 1; min-width: 0">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px">
            <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-primary)">{{
              n.type === 'system' ? '系统通知' : n.nickname || n.username || '用户'
            }}</span>
            <span
              v-if="!n.is_read"
              style="width: 6px; height: 6px; border-radius: 50%; background: var(--amber); flex-shrink: 0"
            ></span>
            <span style="margin-left: auto; font-size: 0.7rem; color: var(--text-muted)">{{
              n.created_at?.slice(5, 16)
            }}</span>
          </div>
          <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; word-break: break-word">
            {{ n.content }}
          </div>
        </div>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <Teleport to="body">
      <div v-if="detail" class="nd-overlay" @click.self="detail = null">
        <div class="nd-card">
          <div class="nd-inner">
            <div
              class="nd-avatar"
              :style="{
                background: detail.sender_id
                  ? `linear-gradient(135deg,var(--amber-dim),var(--amber))`
                  : 'var(--text-muted)',
              }"
            >
              {{ detail.type === 'system' ? '系' : (detail.nickname || detail.username || '?').charAt(0) }}
            </div>
            <div class="nd-info">
              <div class="nd-name">
                {{ detail.type === 'system' ? '系统通知' : detail.nickname || detail.username || '用户' }}
              </div>
              <div v-if="detail.type === 'comment' || detail.type === 'reply'" class="nd-text">
                回复：{{ detail.content }}
              </div>
              <div v-else class="nd-text">{{ detail.content }}</div>
            </div>
          </div>
          <!-- 跳转目标（3.6 契约：target_type+target_id 即跳转目标，如点赞/评论/审核通知 → 对应文章） -->
          <button v-if="targetRoute(detail)" class="nd-go" @click="goTarget">查看详情 ›</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.notify-tab {
  padding: 7px 18px;
  border-radius: 20px;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: all 150ms;
}
.notify-tab:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}
.notify-tab.active {
  background: var(--amber);
  color: var(--on-amber);
  border-color: var(--amber);
  font-weight: 600;
}

.nd-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.nd-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  width: 100%;
  max-width: 420px;
  overflow: hidden;
}
.nd-inner {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px;
}
.nd-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.1rem;
  color: var(--bg-deep);
  flex-shrink: 0;
}
.nd-info {
  flex: 1;
  min-width: 0;
}
.nd-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.nd-text {
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}
.nd-go {
  width: 100%;
  padding: 11px 0;
  border: none;
  cursor: pointer;
  background: var(--amber-glow);
  border-top: 1px solid var(--border-subtle);
  color: var(--amber);
  font-size: 0.85rem;
  font-weight: 600;
  font-family: inherit;
  transition: background var(--transition-fast);
}
.nd-go:hover {
  background: rgba(232, 168, 56, 0.2);
}
</style>
