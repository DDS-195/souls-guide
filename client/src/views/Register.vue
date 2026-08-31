<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { userApi } from '../api'

const router = useRouter()
const route = useRoute()
const form = ref({ username: '', password: '', confirmPassword: '' })
const loading = ref(false)
const errMsg = ref('')

async function handleRegister() {
  errMsg.value = ''
  if (!form.value.username) {
    errMsg.value = '请输入用户名'
    return
  }
  if (form.value.username.length < 2) {
    errMsg.value = '用户名至少2个字符'
    return
  }
  if (!form.value.password) {
    errMsg.value = '请输入密码'
    return
  }
  if (form.value.password.length < 6) {
    errMsg.value = '密码至少6位'
    return
  }
  if (form.value.password !== form.value.confirmPassword) {
    errMsg.value = '两次密码不一致'
    return
  }

  loading.value = true
  try {
    await userApi.register({ username: form.value.username, password: form.value.password })
    // 透传 redirect：注册成功后登录，登录页继续消费回跳（守卫拦截链不断裂）
    router.push({ path: '/login', query: route.query })
  } catch (e: any) {
    errMsg.value = e.response?.data?.message || '注册失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <h1 class="auth-logo" @click="router.push('/')">🔥 SoulsGuide</h1>
      <p class="auth-sub">创建你的猎人笔记</p>

      <div class="auth-form">
        <label class="auth-label">用户名</label>
        <input v-model="form.username" class="auth-input" placeholder="2~20个字符" @keyup.enter="handleRegister" />

        <label class="auth-label">密码</label>
        <input
          v-model="form.password"
          class="auth-input"
          type="password"
          placeholder="至少6位"
          @keyup.enter="handleRegister"
        />

        <label class="auth-label">确认密码</label>
        <input
          v-model="form.confirmPassword"
          class="auth-input"
          type="password"
          placeholder="再次输入密码"
          @keyup.enter="handleRegister"
        />

        <p v-if="errMsg" class="auth-error">{{ errMsg }}</p>

        <button class="auth-btn" :disabled="loading" @click="handleRegister">
          {{ loading ? '注册中...' : '注 册' }}
        </button>
      </div>

      <p class="auth-switch">已有账号？<router-link to="/login">立即登录</router-link></p>
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
  text-shadow: 0 0 30px var(--amber-glow);
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
