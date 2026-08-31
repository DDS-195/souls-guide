<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '../stores/user'
import { userApi } from '../api'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const form = ref({ username: '', password: '' })
const loading = ref(false)
const errMsg = ref('')

async function handleLogin() {
  errMsg.value = ''
  if (!form.value.username) {
    errMsg.value = '请输入用户名'
    return
  }
  if (!form.value.password) {
    errMsg.value = '请输入密码'
    return
  }
  loading.value = true
  try {
    const res: any = await userApi.login(form.value)
    userStore.setToken(res.data.token)
    // 登录接口只返回 {token, username, role}，补拉 /users/me 拿完整信息（含 id/昵称/头像）
    try {
      const me: any = await userApi.getMe()
      userStore.setUserInfo(me.data)
    } catch {
      userStore.setUserInfo({ username: res.data.username, role: res.data.role })
    }
    // 登录后回到被守卫拦截前的页面（?redirect=原路径）；仅接受站内相对路径，防开放重定向
    const redirect = route.query.redirect as string | undefined
    router.push(redirect && redirect.startsWith('/') ? redirect : '/')
  } catch (e: any) {
    errMsg.value = e.response?.data?.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <h1 class="auth-logo" @click="router.push('/')">🔥 SoulsGuide</h1>
      <p class="auth-sub">登录你的猎人笔记</p>

      <div class="auth-form">
        <label class="auth-label">用户名</label>
        <input v-model="form.username" class="auth-input" placeholder="输入用户名" @keyup.enter="handleLogin" />

        <label class="auth-label">密码</label>
        <input
          v-model="form.password"
          class="auth-input"
          type="password"
          placeholder="输入密码"
          @keyup.enter="handleLogin"
        />

        <p v-if="errMsg" class="auth-error">{{ errMsg }}</p>

        <button class="auth-btn" :disabled="loading" @click="handleLogin">
          {{ loading ? '登录中...' : '登 录' }}
        </button>
      </div>

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
