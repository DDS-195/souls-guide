<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { userApi, mediaApi } from '../api'
import { errorMessage } from '../utils/errors'

const userStore = useUserStore()
const router = useRouter()
const saving = ref(false)
const msg = ref('')

const form = ref({ nickname: '', bio: '', gender: '', birthday: '' })
const passwordForm = ref({ current_password: '', new_password: '', confirm_password: '' })
const changingPassword = ref(false)
const passwordMsg = ref('')
let alive = true
onBeforeUnmount(() => { alive = false })

onMounted(async () => {
  try {
    let user = userStore.userInfo
    if (!user) {
      // userInfo 内存态可能丢失（如刷新后直入本页的极端时序）：拉取后同步回 store，
      // 保证后续 uploadAvatar/save 里 userStore.userInfo 非 null（原实现只取不存）
      const me = await userApi.getMe()
      user = me.data
      userStore.setUserInfo(me.data)
    }
    Object.assign(form.value, {
      nickname: user?.nickname || user?.username || '',
      bio: user?.bio || '',
      gender: user?.gender || '',
      birthday: user?.birthday?.slice(0, 10) || '',
    })
  } catch {
    /* 资料拉取失败保持空表单，保存时后端会兜底 */
  }
})

async function uploadAvatar(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 清空选择：允许重复选择同一文件（不清空则同文件二次选择不触发 change）
  if (!file) return
  try {
    const res = await mediaApi.uploadAvatar(file)
    if (userStore.userInfo) userStore.userInfo.avatar = res.data.url
    msg.value = '头像已更新'
  } catch (error: unknown) {
    msg.value = errorMessage(error, '头像上传失败（≤5MB）')
  }
}

async function save() {
  if (saving.value || !alive) return
  const session = userStore.token
  const accountId = userStore.userInfo?.id
  const submitted = { ...form.value }
  saving.value = true
  msg.value = ''
  try {
    await userApi.updateProfile(submitted)
    if (!alive || userStore.token !== session || userStore.userInfo?.id !== accountId) return
    if (userStore.userInfo) {
      Object.assign(userStore.userInfo, submitted)
    }
    msg.value = JSON.stringify(form.value) === JSON.stringify(submitted)
      ? '保存成功'
      : '已保存提交时的资料，当前新修改尚未保存'
  } catch (error: unknown) {
    if (alive && userStore.token === session) msg.value = errorMessage(error, '保存失败')
  } finally {
    saving.value = false
  }
}

async function changePassword() {
  passwordMsg.value = ''
  if (passwordForm.value.new_password !== passwordForm.value.confirm_password) {
    passwordMsg.value = '两次输入的新密码不一致'
    return
  }
  changingPassword.value = true
  try {
    await userApi.changePassword({
      current_password: passwordForm.value.current_password,
      new_password: passwordForm.value.new_password,
    })
    userStore.logout()
    await router.replace('/login')
  } catch (error: unknown) {
    passwordMsg.value = errorMessage(error, '密码修改失败')
  } finally {
    changingPassword.value = false
  }
}
</script>

<template>
  <div style="max-width: 500px; margin: 0 auto; padding: 24px 16px; color: var(--text-primary)">
    <!-- 头像 + 信息 -->
    <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 24px">
      <label style="cursor: pointer; flex-shrink: 0">
        <div
          :style="{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            background: userStore.userInfo?.avatar
              ? `url(${userStore.userInfo.avatar}) center/cover`
              : 'linear-gradient(135deg,var(--amber-dim),var(--amber))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.8rem',
            fontWeight: '700',
            color: 'var(--bg-deep)',
          }"
        >
          <span v-if="!userStore.userInfo?.avatar">{{ userStore.userInfo?.username?.charAt(0) || 'U' }}</span>
        </div>
        <input type="file" accept="image/*" hidden @change="uploadAvatar" />
      </label>
      <div style="flex: 1">
        <input
          v-model="form.nickname"
          class="inp"
          placeholder="昵称"
          maxlength="20"
          style="font-size: 1.1rem; font-weight: 600; margin-bottom: 6px"
        />
        <input v-model="form.bio" class="inp" placeholder="个性签名" maxlength="100" />
      </div>
    </div>

    <!-- 表单 -->
    <div style="display: flex; flex-direction: column; gap: 12px">
      <div style="display: flex; gap: 12px">
        <div style="flex: 1">
          <label class="lbl">性别</label>
          <select v-model="form.gender" class="inp">
            <option value="">未设置</option>
            <option value="男">男</option>
            <option value="女">女</option>
          </select>
        </div>
        <div style="flex: 1">
          <label class="lbl">生日</label>
          <input v-model="form.birthday" class="inp" type="date" />
        </div>
      </div>
    </div>

    <p v-if="msg" style="text-align: center; margin-top: 12px; color: var(--green); font-size: 0.85rem">{{ msg }}</p>

    <button
      :disabled="saving"
      style="
        width: 100%;
        margin-top: 20px;
        padding: 12px;
        background: var(--amber);
        border: none;
        border-radius: 10px;
        color: var(--on-amber);
        font-weight: 600;
        font-size: 0.95rem;
        cursor: pointer;
        font-family: inherit;
      "
      @click="save"
    >
      {{ saving ? '保存中...' : '保存' }}
    </button>

    <section class="password-card">
      <h2>修改密码</h2>
      <input v-model="passwordForm.current_password" class="inp" type="password" autocomplete="current-password" placeholder="当前密码" />
      <input v-model="passwordForm.new_password" class="inp" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder="新密码（8~72 位）" />
      <input v-model="passwordForm.confirm_password" class="inp" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder="再次输入新密码" />
      <p v-if="passwordMsg" class="password-message">{{ passwordMsg }}</p>
      <button class="password-button" :disabled="changingPassword" @click="changePassword">
        {{ changingPassword ? '修改中...' : '修改密码' }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.lbl {
  display: block;
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.inp {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 0.9rem;
  font-family: inherit;
  outline: none;
}
.inp:focus {
  border-color: var(--amber);
}
select.inp {
  cursor: pointer;
}
.password-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 28px;
  padding-top: 22px;
  border-top: 1px solid var(--border-subtle);
}
.password-card h2 {
  margin: 0 0 4px;
  font-size: 1rem;
}
.password-message {
  margin: 0;
  color: var(--red);
  font-size: 0.85rem;
}
.password-button {
  padding: 11px;
  border: 1px solid var(--amber);
  border-radius: 10px;
  background: transparent;
  color: var(--amber);
  cursor: pointer;
  font-family: inherit;
  font-weight: 600;
}
</style>
