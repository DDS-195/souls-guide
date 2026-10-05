import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '../types/api'
import { safeStorage } from '../utils/storage'

function completeIdentity(info: User | null | undefined): info is User {
  return !!info && Number.isSafeInteger(info.id) && info.id > 0 &&
    typeof info.username === 'string' && !!info.username && ['user', 'creator', 'admin'].includes(info.role)
}

export const useUserStore = defineStore('user', () => {
  const token = ref(safeStorage.getItem('token') || '')
  const userInfo = ref<User | null>(null)
  let identityFlight: { session: string; promise: Promise<User> } | undefined
  const unreadCount = ref(0)
  let unreadTicket = 0
  let unreadFlight: { session: string; ticket: number; promise: Promise<void> } | undefined
  function invalidateUnread() {
    unreadTicket++
  }
  function refreshUnread(): Promise<void> {
    const session = token.value
    if (!session) {
      unreadCount.value = 0
      return Promise.resolve()
    }
    if (unreadFlight?.session === session && unreadFlight.ticket === unreadTicket) return unreadFlight.promise
    const ticket = ++unreadTicket
    const promise = (async () => { try {
      const { interactApi } = await import('../api')
      if (session !== token.value || ticket !== unreadTicket) return
      const result = await interactApi.getNotificationSummary()
      if (session === token.value && ticket === unreadTicket) unreadCount.value = result.data.unread
    } catch {
      /* 保留上次成功结果，后续前台刷新重试 */
    } })()
    unreadFlight = { session, ticket, promise }
    void promise.finally(() => { if (unreadFlight?.promise === promise) unreadFlight = undefined }).catch(() => {})
    return promise
  }

  const role = computed(() => userInfo.value?.role || 'user')
  const isLoggedIn = computed(() => !!token.value)

  function setToken(t: string) {
    invalidateUnread()
    unreadCount.value = 0
    if (t !== token.value) {
      userInfo.value = null
      identityFlight = undefined
    }
    token.value = t
    safeStorage.setItem('token', t)
  }

  function setUserInfo(info: User) {
    if (!completeIdentity(info)) throw new Error('用户资料不完整，请重新加载')
    userInfo.value = info
  }

  // 私有页面必须有完整账户标识，不能用登录响应中的 username/role 代替 /users/me。
  function ensureUserInfo(): Promise<User> {
    const session = token.value
    if (!session) return Promise.reject(new Error('请先登录'))
    if (completeIdentity(userInfo.value)) return Promise.resolve(userInfo.value)
    if (identityFlight?.session === session) return identityFlight.promise
    const promise = (async () => {
      const { userApi } = await import('../api')
      if (session !== token.value) throw new Error('登录账号已变化')
      const result = await userApi.getMe()
      if (session !== token.value) throw new Error('登录账号已变化')
      setUserInfo(result.data)
      return result.data
    })()
    identityFlight = { session, promise }
    void promise.finally(() => {
      if (identityFlight?.promise === promise) identityFlight = undefined
    }).catch(() => {})
    return promise
  }

  function logout() {
    document.cookie = 'sg_media=; Path=/uploads; Max-Age=0; SameSite=Strict'
    invalidateUnread()
    unreadCount.value = 0
    token.value = ''
    userInfo.value = null
    identityFlight = undefined
    safeStorage.removeItem('token')
  }

  return {
    token,
    userInfo,
    unreadCount,
    role,
    isLoggedIn,
    setToken,
    setUserInfo,
    ensureUserInfo,
    logout,
    refreshUnread,
    invalidateUnread,
  }
})
