<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '../stores/user'
import { userApi } from '../api'
import { errorMessage } from '../utils/errors'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const form = ref({ username: '', password: '' })
const loading = ref(false)
const pendingSession = ref(userStore.token && !userStore.userInfo ? userStore.token : '')
const errMsg = ref(pendingSession.value ? '用户资料尚未加载完成，请点击重试' : '')
let alive = true
onBeforeUnmount(() => { alive = false })

async function handleLogin() {
  if (loading.value || !alive) return
  errMsg.value = ''
  const retryProfile = !!pendingSession.value && pendingSession.value === userStore.token
  if (!retryProfile && !form.value.username) {
    errMsg.value = '请输入用户名'
    return
  }
  if (!retryProfile && !form.value.password) {
    errMsg.value = '请输入密码'
    return
  }
  loading.value = true
  try {
    if (!retryProfile) {
      const res = await userApi.login({ ...form.value })
      if (!alive) return
      userStore.setToken(res.data.token)
      pendingSession.value = res.data.token
    }
    const session = pendingSession.value
    await userStore.ensureUserInfo()
    if (!alive || session !== userStore.token) return
    // 登录后回到被守卫拦截前的页面（?redirect=原路径）；仅接受站内相对路径，防开放重定向
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    const safeRedirect = redirect.startsWith('/') && !redirect.startsWith('//') && !redirect.startsWith('/\\')
    router.push(safeRedirect ? redirect : '/')
  } catch (error: unknown) {
    if (!alive) return
    errMsg.value = pendingSession.value && pendingSession.value === userStore.token
      ? '登录凭证已获取，但用户资料加载失败。请点击重试加载资料。'
      : errorMessage(error, '登录失败')
  } finally {
    if (alive) loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <h1 class="auth-logo"><router-link to="/">🔥 SoulsGuide</router-link></h1>
      <p class="auth-sub">登录你的猎人笔记</p>

      <form class="auth-form" @submit.prevent="handleLogin">
        <label class="auth-label" for="login-username">用户名</label>
        <input id="login-username" v-model="form.username" name="username" autocomplete="username" :disabled="loading || !!pendingSession && pendingSession === userStore.token" class="auth-input" placeholder="输入用户名" />

        <label class="auth-label" for="login-password">密码</label>
        <input
          id="login-password"
          v-model="form.password"
          name="password"
          autocomplete="current-password"
          :disabled="loading || !!pendingSession && pendingSession === userStore.token"
          class="auth-input"
          type="password"
          placeholder="输入密码"
        />

        <p v-if="errMsg" class="auth-error" role="alert">{{ errMsg }}</p>

        <button type="submit" class="auth-btn" :disabled="loading">
          {{ loading ? '加载中...' : pendingSession && pendingSession === userStore.token ? '重试加载资料' : '登 录' }}
        </button>
      </form>

      <p class="auth-switch">没有账号？<router-link to="/register">立即注册</router-link></p>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 200px);
  padding: 20px;
}
.auth-card {
  width: 100%;
  max-width: 400px;
  padding: 40px 32px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
}
.auth-logo {
  font-family: 'Cinzel', 'Times New Roman', serif;
  font-size: 1.6rem;
  font-weight: 900;
  color: var(--amber);
  text-align: center;
  text-shadow: 0 0 30px rgba(232, 168, 56, 0.12);
  margin-bottom: 4px;
  cursor: pointer;
}
.auth-sub {
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-bottom: 28px;
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.auth-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-weight: 500;
  margin-top: 10px;
  margin-bottom: 4px;
}
.auth-input {
  padding: 12px 14px;
  background: var(--bg-sidebar);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 0.95rem;
  font-family: inherit;
  outline: none;
  transition: border-color 150ms;
}
.auth-input:focus {
  border-color: var(--amber);
}
.auth-input::placeholder {
  color: var(--text-muted);
}
.auth-error {
  color: var(--red);
  font-size: 0.8rem;
  margin-top: 8px;
  margin-bottom: 0;
}
.auth-btn {
  margin-top: 20px;
  padding: 12px;
  background: var(--amber);
  border: none;
  border-radius: 8px;
  color: var(--on-amber);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms;
  font-family: inherit;
}
.auth-btn:hover:not(:disabled) {
  background: var(--amber-dim);
}
.auth-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.auth-switch {
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-top: 20px;
}
.auth-switch a {
  color: var(--amber);
}
</style>
