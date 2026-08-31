<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { userApi, interactApi } from '../api'
import { useTheme } from '../utils/theme'
import ThemeSwitch from '../components/ThemeSwitch.vue'

const userStore = useUserStore()
const router = useRouter()
const { isDark } = useTheme()
const themeSwitch = ref<InstanceType<typeof ThemeSwitch>>()
const applying = ref(false)
const applyMsg = ref('')
const favTotal = ref(0)
const historyCount = ref(0)
const followTotal = ref(0)
const followerTotal = ref(0)

onMounted(async () => {
  try {
    const r = await interactApi.getFavorites()
    favTotal.value = r.data.total
  } catch {
    /* 统计失败显示 0 */
  }
  try {
    historyCount.value = JSON.parse(localStorage.getItem('viewHistory') || '[]').length
  } catch {
    /* 本地历史损坏显示 0 */
  }
  // 关注/粉丝实时数：GET /users/:id（D18 公开契约，统计为实时 COUNT）
  try {
    const me: any = await userApi.getProfile(userStore.userInfo?.id)
    followTotal.value = me.data.following_count || 0
    followerTotal.value = me.data.follower_count || 0
  } catch {
    /* 统计失败显示 0 */
  }
})

// 申请创作者：弹窗填写申请理由后提交（POST /users/apply-creator body { reason }）
const applyOpen = ref(false)
const applyReason = ref('')
const applyOk = ref(false)

function openApply() {
  applyOpen.value = true
  applyReason.value = ''
  applyMsg.value = ''
}

async function submitApply() {
  if (!applyReason.value.trim()) {
    applyOk.value = false
    applyMsg.value = '请填写申请理由'
    return
  }
  applying.value = true
  applyMsg.value = ''
  try {
    const res: any = await userApi.applyCreator(applyReason.value.trim())
    applyOk.value = true
    applyMsg.value = res.message
    applyOpen.value = false
    applyReason.value = ''
  } catch (e: any) {
    applyOk.value = false
    applyMsg.value = e.response?.data?.message || '申请失败'
  } finally {
    applying.value = false
  }
}

const roleLabel: Record<string, string> = { admin: '管理员', creator: '创作者', user: '普通用户' }

/** 退出登录：清态并回首页（多语句抽方法——内联多语句 handler 会被 Prettier 换行拆坏表达式） */
function handleLogout() {
  userStore.logout()
  router.push('/')
}
</script>

<template>
  <div style="max-width: 500px; margin: 0 auto; padding: 24px 16px 40px; color: var(--text-primary)">
    <!-- 头部（可点击跳编辑） -->
    <div
      style="display: flex; align-items: center; gap: 14px; margin-bottom: 20px; cursor: pointer"
      @click="router.push('/me/edit')"
    >
      <div
        :style="{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          flexShrink: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
          fontWeight: '700',
          color: 'var(--bg-deep)',
          background: userStore.userInfo?.avatar
            ? `url(${userStore.userInfo.avatar}) center/cover`
            : 'linear-gradient(135deg,var(--amber-dim),var(--amber))',
        }"
      >
        <span v-if="!userStore.userInfo?.avatar">{{
          (userStore.userInfo?.nickname || userStore.userInfo?.username || 'U').charAt(0)
        }}</span>
      </div>
      <div style="flex: 1">
        <div style="font-size: 1.1rem; font-weight: 600">
          {{ userStore.userInfo?.nickname || userStore.userInfo?.username }}
        </div>
        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px">
          {{ userStore.userInfo?.bio || '这个人很懒，什么都没写' }}
        </div>
      </div>
      <span
        style="
          padding: 2px 10px;
          border-radius: 10px;
          font-size: 0.68rem;
          background: var(--amber-glow);
          color: var(--amber);
          flex-shrink: 0;
        "
        >{{ roleLabel[userStore.role] || userStore.role }}</span
      >
    </div>

    <!-- 四组数据 -->
    <div
      style="
        display: flex;
        justify-content: space-around;
        padding: 18px 0;
        margin-bottom: 20px;
        border-top: 1px solid var(--border-subtle);
        border-bottom: 1px solid var(--border-subtle);
      "
    >
      <div class="stat" @click="router.push('/me/following')">
        <span class="stat-num">{{ followTotal }}</span
        ><span class="stat-label">关注</span>
      </div>
      <div class="stat" @click="router.push('/me/followers')">
        <span class="stat-num">{{ followerTotal }}</span
        ><span class="stat-label">粉丝</span>
      </div>
      <div class="stat" @click="router.push('/me/favorites')">
        <span class="stat-num">{{ favTotal }}</span
        ><span class="stat-label">收藏</span>
      </div>
      <div class="stat" @click="router.push('/me/history')">
        <span class="stat-num">{{ historyCount }}</span
        ><span class="stat-label">浏览</span>
      </div>
    </div>

    <!-- 角色功能入口 -->
    <div style="display: flex; flex-direction: column; gap: 10px">
      <!-- 普通用户 -->
      <template v-if="userStore.role === 'user'">
        <button
          class="fn-btn"
          style="background: var(--amber-glow); color: var(--amber); border-color: rgba(232, 168, 56, 0.2)"
          @click="openApply"
        >
          ✏️ 申请成为创作者
        </button>
        <p
          v-if="applyMsg"
          :style="{ textAlign: 'center', fontSize: '0.82rem', color: applyOk ? 'var(--green)' : 'var(--red)' }"
        >
          {{ applyMsg }}
        </p>
      </template>

      <!-- 创作者 -->
      <template v-if="userStore.role === 'creator' || userStore.role === 'admin'">
        <button
          class="fn-btn"
          style="background: var(--amber-glow); color: var(--amber); border-color: rgba(232, 168, 56, 0.2)"
          @click="router.push('/creator/write')"
        >
          ✏️ 写攻略
        </button>
        <button class="fn-btn" @click="router.push('/creator/posts')">📝 我的作品</button>
        <button class="fn-btn" @click="router.push('/creator/stats')">📊 数据统计</button>
      </template>

      <!-- 深色模式（所有用户，放基本功能最下面） -->
      <button class="fn-btn" style="display: flex; align-items: center" @click="themeSwitch?.open()">
        <span style="flex: 1"></span>
        <span>🌓 深色模式</span>
        <span style="flex: 1; text-align: right; color: var(--text-muted); font-size: 0.8rem"
          >{{ isDark ? '已开启' : '已关闭' }} ›</span
        >
      </button>

      <!-- 管理员 -->
      <template v-if="userStore.role === 'admin'">
        <div style="height: 1px; background: var(--border-subtle); margin: 4px 0"></div>
        <button class="fn-btn admin-entry" @click="router.push('/admin/pending')">📋 内容审核</button>
        <button class="fn-btn admin-entry" @click="router.push('/admin/applications')">📝 创作者申请</button>
        <button class="fn-btn admin-entry" @click="router.push('/admin/games')">🎮 游戏管理</button>
        <button class="fn-btn admin-entry" @click="router.push('/admin/announcements')">📢 公告管理</button>
        <button class="fn-btn admin-entry" @click="router.push('/admin/users')">👥 用户管理</button>
        <button class="fn-btn admin-entry" @click="router.push('/admin/logs')">📜 日志管理</button>
      </template>
    </div>

    <button class="logout-btn" @click="handleLogout">退出登录</button>

    <ThemeSwitch ref="themeSwitch" />

    <!-- 申请创作者弹窗：填写申请理由 -->
    <Teleport to="body">
      <div v-if="applyOpen" class="apply-ov" @click.self="applyOpen = false">
        <div class="apply-card">
          <div class="apply-title">申请成为创作者</div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 10px">
            请填写你的申请理由（如擅长游戏、内容方向等），管理员审核通过后即可发布攻略
          </div>
          <textarea
            v-model="applyReason"
            class="apply-input"
            rows="4"
            maxlength="300"
            placeholder="申请理由（必填，≤300 字）"
          ></textarea>
          <div style="display: flex; gap: 8px; margin-top: 12px">
            <button class="apply-btn" @click="applyOpen = false">取消</button>
            <button class="apply-btn primary" :disabled="applying" @click="submitApply">
              {{ applying ? '提交中...' : '提交申请' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.stat {
  text-align: center;
  cursor: pointer;
}
.stat:hover .stat-num {
  color: var(--amber);
}
.stat-num {
  display: block;
  font-size: 1.15rem;
  font-weight: 700;
  transition: color 150ms;
}
.stat-label {
  display: block;
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-top: 2px;
}
.fn-btn {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  font-size: 0.88rem;
  cursor: pointer;
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  font-family: inherit;
  transition: all 150ms;
  text-align: center;
}
.fn-btn:hover {
  background: var(--bg-hover);
}
/* 管理员功能入口（2026-08-16 样式统一：原内联 rgba(59,157,181,...) 迁移至此） */
.fn-btn.admin-entry {
  background: rgba(59, 157, 181, 0.08);
  color: var(--cyan);
  border-color: rgba(59, 157, 181, 0.2);
}
.fn-btn.admin-entry:hover {
  background: rgba(59, 157, 181, 0.15);
  color: var(--cyan);
}
.logout-btn {
  display: block;
  width: 100%;
  margin-top: 28px;
  padding: 12px;
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  color: var(--red);
  cursor: pointer;
  font-size: 0.85rem;
  font-family: inherit;
}
.logout-btn:hover {
  background: var(--bg-hover);
}

/* 申请创作者弹窗 */
.apply-ov {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.apply-card {
  width: 100%;
  max-width: 420px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 18px;
}
.apply-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--amber);
  margin-bottom: 8px;
}
.apply-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  background: var(--bg-sidebar);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.82rem;
  font-family: inherit;
  resize: vertical;
  outline: none;
}
.apply-input:focus {
  border-color: var(--amber);
}
.apply-btn {
  flex: 1;
  padding: 7px 0;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  background: var(--bg-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-family: inherit;
  transition: all 150ms;
}
.apply-btn:hover {
  color: var(--text-primary);
}
.apply-btn.primary {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--on-amber);
  font-weight: 600;
}
.apply-btn.primary:hover {
  background: var(--amber-dim);
  color: var(--on-amber);
}
.apply-btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
