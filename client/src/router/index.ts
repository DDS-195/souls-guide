import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '../stores/user'
import { userApi } from '../api'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'Home', component: () => import('../views/Home.vue') },
    { path: '/post/:id', name: 'PostDetail', component: () => import('../views/PostDetail.vue') },
    { path: '/search', name: 'Search', component: () => import('../views/Search.vue') },
    { path: '/user/:id', name: 'UserProfile', component: () => import('../views/UserProfile.vue') },
    {
      path: '/notifications',
      name: 'Notifications',
      meta: { auth: true },
      component: () => import('../views/Notifications.vue'),
    },
    { path: '/login', name: 'Login', component: () => import('../views/Login.vue') },
    { path: '/register', name: 'Register', component: () => import('../views/Register.vue') },
    {
      path: '/me/profile',
      name: 'Profile',
      meta: { auth: true },
      component: () => import('../views/Profile.vue'),
    },
    {
      path: '/me/following',
      name: 'MyFollowing',
      meta: { auth: true },
      component: () => import('../views/MyLists.vue'),
    },
    {
      path: '/me/followers',
      name: 'MyFollowers',
      meta: { auth: true },
      component: () => import('../views/MyLists.vue'),
    },
    {
      path: '/me/favorites',
      name: 'MyFavorites',
      meta: { auth: true },
      component: () => import('../views/MyLists.vue'),
    },
    { path: '/me/history', name: 'MyHistory', meta: { auth: true }, component: () => import('../views/MyLists.vue') },
    {
      path: '/me/edit',
      name: 'EditProfile',
      meta: { auth: true },
      component: () => import('../views/EditProfile.vue'),
    },
    {
      path: '/creator',
      meta: { auth: true, roles: ['creator', 'admin'] },
      redirect: '/creator/posts',
      children: [
        { path: 'write', name: 'Write', component: () => import('../views/creator/Write.vue') },
        { path: 'write/:id', name: 'EditPost', component: () => import('../views/creator/Write.vue') },
        { path: 'posts', name: 'MyPosts', component: () => import('../views/creator/MyPosts.vue') },
        { path: 'stats', name: 'Stats', component: () => import('../views/creator/Stats.vue') },
      ],
    },
    {
      path: '/admin',
      meta: { auth: true, roles: ['admin'] },
      children: [
        { path: 'pending', name: 'Pending', component: () => import('../views/admin/Pending.vue') },
        { path: 'applications', name: 'Applications', component: () => import('../views/admin/Applications.vue') },
        { path: 'reports', name: 'Reports', component: () => import('../views/admin/Reports.vue') },
        { path: 'announcements', name: 'Announcements', component: () => import('../views/admin/Announcements.vue') },
        { path: 'games', name: 'Games', component: () => import('../views/admin/Games.vue') },
        { path: 'users', name: 'UserManage', component: () => import('../views/admin/UserManage.vue') },
        { path: 'logs', name: 'AdminLogs', component: () => import('../views/admin/AdminLogs.vue') },
      ],
    },
  ],
})

router.beforeEach(async (to, _from, next) => {
  const userStore = useUserStore()
  if (!to.meta.auth) return next()
  if (!userStore.token) return next({ path: '/login', query: { redirect: to.fullPath } })
  // 刷新后 userInfo 是内存态会丢失（token 在 localStorage 保留）：守卫先异步恢复，
  // 避免 creator/admin 被误判为 user 踢回首页（2026-08-09 P1-4 修复）
  if (!userStore.userInfo) {
    try {
      const me: any = await userApi.getMe()
      if (me?.data) userStore.setUserInfo(me.data)
    } catch {
      // 401 已由 request 拦截器 logout + 跳登录，这里兜底清态
      userStore.logout()
      return next({ path: '/login', query: { redirect: to.fullPath } })
    }
  }
  const roles = to.meta.roles as string[] | undefined
  if (roles && !roles.includes(userStore.role)) return next({ path: '/' })
  next()
})

export default router
