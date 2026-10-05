<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, provide, shallowRef } from 'vue'
import { pageBackKey } from './composables/pageBack'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from './stores/user'
import { userApi } from './api'
import { toast } from './utils/toast'
import AnnouncementModal from './components/AnnouncementModal.vue'
import { articleReturnLocation, prepareArticleReturn } from './utils/articleMotion'

const router = useRouter()
const route = useRoute()
const routeTransition = ref('route-slice')
watch(() => route.path, (to, from) => {
  prepareArticleReturn(from, to, route.fullPath)
  routeTransition.value = to.startsWith('/post/') || from.startsWith('/post/') ? 'article-route' : 'route-slice'
})
const pageBack = shallowRef<(() => boolean) | null>(null)
provide(pageBackKey, pageBack)
function goBack() {
  if (pageBack.value?.()) return
  if (route.name === 'PostDetail') {
    const location = articleReturnLocation(String(route.params.id))
    if (location) {
      if (window.history.state?.back === location) router.back()
      else void router.replace(location)
      return
    }
  }
  // 审核入口的业务父页面固定为“我的”，直接 URL 访问也可以返回。
  if (route.name === 'Pending') {
    void router.replace('/me/profile')
    return
  }
  if (window.history.state?.back) router.back()
  else
    void router.replace(
      route.path.startsWith('/admin') || route.path.startsWith('/creator') || route.path.startsWith('/me')
        ? '/me/profile'
        : '/',
    )
}
const userStore = useUserStore()
const syncUnread = () => { if (!document.hidden) void userStore.refreshUnread() }
watch(() => userStore.token, syncUnread, { immediate: true })
const unreadTimer = window.setInterval(syncUnread, 30000)
window.addEventListener('focus', syncUnread)
document.addEventListener('visibilitychange', syncUnread)
onUnmounted(() => {
  clearInterval(unreadTimer)
  window.removeEventListener('focus', syncUnread)
  document.removeEventListener('visibilitychange', syncUnread)
})
const isMobile = ref(window.innerWidth < 768)
function updateViewport() {
  isMobile.value = window.innerWidth < 768
}
window.addEventListener('resize', updateViewport)
onUnmounted(() => window.removeEventListener('resize', updateViewport))

const tabs = ['/', '/notifications', '/me/profile']
const isSubPage = computed(() => !tabs.some((t) => route.path === t))
// 导航栏按角色动态渲染（9.2 缺口 2）：creator/admin 可见创作中心，admin 另可见管理后台
const isCreator = computed(() => ['creator', 'admin'].includes(userStore.role))
const isAdmin = computed(() => userStore.role === 'admin')

onMounted(async () => {
  if (userStore.token) {
    const session = userStore.token
    try {
      const res = await userApi.getMe()
      if (userStore.token === session) userStore.setUserInfo(res.data)
    } catch {
      // 无效凭证由拦截器处理；临时服务故障不能清除有效登录。
      if (userStore.token === session) toast('用户资料暂时加载失败，请稍后重试', 'error')
    }
  }
})
</script>

<template>
  <!-- 子页面顶栏（非 Tab 页面） -->
  <div v-if="isSubPage" class="sub-topbar">
    <button
      type="button"
      class="sub-back"
      aria-label="返回上一级"
      style="background: none; border: 0; font: inherit"
      @click="goBack"
    >
      ←
    </button>
  </div>

  <header v-if="isMobile && !isSubPage" class="mobile-header">
    <div class="mobile-header-top">
      <h2><router-link to="/" class="header-home-link">🔥 SoulsGuide</router-link></h2>
    </div>
  </header>

  <div class="app">
    <aside v-if="!isMobile && !isSubPage" class="sidebar">
      <router-link class="sidebar-logo" :to="'/'">
        <h1>🔥 SoulsGuide</h1>
        <span>Player's Journal</span>
      </router-link>
      <nav class="sidebar-nav">
        <router-link class="nav-item" :class="{ active: route.path === '/' }" :to="'/'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          首页
        </router-link>
        <router-link
          class="nav-item"
          :class="{ active: route.path.startsWith('/notifications') }"
          :to="'/notifications'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          通知
          <span v-if="userStore.unreadCount" class="nav-badge">{{ userStore.unreadCount }}</span>
        </router-link>
        <router-link class="nav-item" :class="{ active: route.path.startsWith('/me') }" :to="'/me/profile'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          我的
        </router-link>

        <!-- 创作中心（creator/admin） -->
        <template v-if="isCreator">
          <div class="nav-group">创作中心</div>
          <router-link
            class="nav-item"
            :class="{ active: route.path === '/creator/write' || route.path.startsWith('/creator/write/') }"
            :to="'/creator/write'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            写攻略
          </router-link>
          <router-link
            class="nav-item"
            :class="{ active: route.path === '/creator/posts' }"
            :to="'/creator/posts'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            我的作品
          </router-link>
          <router-link
            class="nav-item"
            :class="{ active: route.path === '/creator/stats' }"
            :to="'/creator/stats'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="20" x2="12" y2="10" />
              <line x1="18" y1="20" x2="18" y2="4" />
              <line x1="6" y1="20" x2="6" y2="16" />
            </svg>
            数据统计
          </router-link>
        </template>

        <!-- 管理后台（admin） -->
        <template v-if="isAdmin">
          <div class="nav-group">管理后台</div>
          <router-link
            class="nav-item"
            :class="{ active: route.path === '/admin/pending' }"
            :to="'/admin/pending'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
            内容审核
          </router-link>
          <router-link
            class="nav-item"
            :class="{ active: route.path === '/admin/applications' }"
            :to="'/admin/applications'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
            创作者申请
          </router-link>
          <router-link
            class="nav-item"
            :class="{ active: route.path === '/admin/reports' }"
            :to="'/admin/reports'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
            举报管理
          </router-link>
          <router-link
            class="nav-item"
            :class="{ active: route.path === '/admin/announcements' }"
            :to="'/admin/announcements'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 11l18-5v12L3 14v-3z" />
              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
            </svg>
            公告管理
          </router-link>
          <router-link
            class="nav-item"
            :class="{ active: route.path === '/admin/notifications-send' }"
            :to="'/admin/notifications-send'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
              <path d="M13.7 21a2 2 0 0 1-3.4 0" />
            </svg>
            系统通知
          </router-link>
          <router-link class="nav-item" :class="{ active: route.path === '/admin/games' }" :to="'/admin/games'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="6" y1="11" x2="10" y2="11" />
              <line x1="8" y1="9" x2="8" y2="13" />
              <line x1="15" y1="12" x2="15.01" y2="12" />
              <line x1="18" y1="10" x2="18.01" y2="10" />
              <path
                d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"
              />
            </svg>
            游戏管理
          </router-link>
          <router-link class="nav-item" :class="{ active: route.path === '/admin/users' }" :to="'/admin/users'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            用户管理
          </router-link>
          <router-link class="nav-item" :class="{ active: route.path === '/admin/logs' }" :to="'/admin/logs'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            日志管理
          </router-link>
        </template>
      </nav>
      <div class="sidebar-footer">
        <router-link v-if="userStore.isLoggedIn" class="user-card" :to="'/me/profile'">
          <div
            class="user-avatar"
            :style="userStore.userInfo?.avatar ? { background: `url(${userStore.userInfo.avatar}) center/cover` } : {}"
          >
            <span v-if="!userStore.userInfo?.avatar">{{
              (userStore.userInfo?.nickname || userStore.userInfo?.username || 'U').charAt(0)
            }}</span>
          </div>
          <div class="user-info">
            <div class="name">{{ userStore.userInfo?.nickname || userStore.userInfo?.username || '用户' }}</div>
            <div class="role">{{ userStore.userInfo?.bio || userStore.role }}</div>
          </div>
        </router-link>
        <!-- 游客登录入口：桌面端侧边栏此前无任何登录按钮（游客只能靠守卫踢跳，入口隐蔽） -->
        <button v-else class="sidebar-login-btn" @click="router.push('/login')">登录 / 注册</button>
      </div>
    </aside>

    <main class="main" :class="{ 'main--nopad': isSubPage, 'main--home': route.name === 'Home' }">
      <router-view v-slot="{ Component, route: viewRoute }">
        <Transition :name="routeTransition" mode="out-in">
          <div
            :key="viewRoute.path"
            class="route-stage"
          >
            <component :is="Component" />
          </div>
        </Transition>
      </router-view>
    </main>
  </div>

  <nav v-if="isMobile && !isSubPage" class="mobile-nav">
    <div class="mobile-nav-items">
      <router-link class="mobile-nav-item" :class="{ active: route.path === '/' }" :to="'/'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        首页
      </router-link>
      <router-link
        class="mobile-nav-item"
        :class="{ active: route.path.startsWith('/notifications') }"
        style="position: relative"
        :to="'/notifications'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <span v-if="userStore.unreadCount" class="nav-dot"></span>
        通知
      </router-link>
      <router-link
        class="mobile-nav-item"
        :class="{ active: route.path.startsWith('/me') }"
        :to="'/me/profile'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        我的
      </router-link>
    </div>
  </nav>

  <!-- 公告弹窗（首次进入且有 published 公告时弹出，关闭后 localStorage 记录） -->
  <AnnouncementModal />
</template>
