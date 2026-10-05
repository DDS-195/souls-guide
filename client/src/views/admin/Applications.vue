<script setup lang="ts">
// 创作者申请审核页（/admin/applications，auth+admin）
// 数据源：GET /admin/applications（分页，返回 users.* 含 apply_reason/avatar）
// 管理员可点击申请人头像/用户名跳转个人主页核实资料后再 通过/驳回
import { ref, onMounted } from 'vue'
import { adminApi } from '../../api'
import { toast } from '../../utils/toast'
import AppPagination from '../../components/AppPagination.vue'
import AppEmpty from '../../components/AppEmpty.vue'
import UserAvatar from '../../components/UserAvatar.vue'
import AppModal from '../../components/AppModal.vue'
import { usePagination } from '../../composables/usePagination'
import { errorMessage } from '../../utils/errors'
import type { CreatorApplication } from '../../types/api'

const list = ref<CreatorApplication[]>([])
const tab = ref<'pending' | 'processed'>('pending')
const selected = ref<CreatorApplication | null>(null)
const decision = ref<'approved' | 'rejected'>('approved')
const reason = ref('')
const saving = ref(false)
const decisionError = ref('')
let requestId = 0
const loading = ref(true)
const error = ref('')
const { page, total, pageCount, pageSize, go } = usePagination(10)

async function load() {
  const current = ++requestId
  loading.value = true
  error.value = ''
  try {
    const r = await adminApi.getApplications({ page: page.value, pageSize, status: tab.value })
    if (current !== requestId) return
    list.value = r.data.list || []
    total.value = r.data.total || 0
    if (page.value > Math.max(1, pageCount.value)) {
      page.value = Math.max(1, pageCount.value)
      return load()
    }
  } catch (requestError: unknown) {
    if (current === requestId) error.value = errorMessage(requestError, '加载失败，请重试')
  } finally {
    if (current === requestId) loading.value = false
  }
}

onMounted(load)

function goPage(p: number) {
  if (go(p)) load()
}

function switchTab(value: 'pending' | 'processed') {
  tab.value = value
  page.value = 1
  load()
}
function openDecision(u: CreatorApplication, value: 'approved' | 'rejected') {
  selected.value = u
  decision.value = value
  reason.value = ''
  decisionError.value = ''
}
async function confirmDecision() {
  const u = selected.value
  if (!u || saving.value) return
  if (decision.value === 'rejected' && (!reason.value.trim() || reason.value.trim().length > 500)) {
    decisionError.value = '请填写 1–500 字的驳回原因'
    return
  }
  saving.value = true
  decisionError.value = ''
  try {
    if (decision.value === 'approved') await adminApi.approveApplication(u.user_id, u.id)
    else await adminApi.rejectApplication(u.user_id, u.id, reason.value.trim())
    toast('申请已处理', 'success')
    selected.value = null
  } catch (error: unknown) {
    toast(errorMessage(error, '操作失败，请刷新后重试'), 'error')
    selected.value = null
  } finally {
    saving.value = false
    await load()
  }
}
</script>

<template>
  <div style="max-width: 900px; margin: 0 auto; padding: 20px 16px 40px; color: var(--text-primary)">
    <!-- 头部 -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
      <div style="display: flex; align-items: center; gap: 10px">
        <h2 style="font-family: Cinzel, serif; color: var(--amber)">创作者申请</h2>
        <span v-if="!loading && !error" class="badge">{{ total }} 条{{ tab === 'pending' ? '待审' : '已处理' }}</span>
      </div>
      <button class="refresh-btn" :disabled="loading || saving" @click="load">↻ 刷新</button>
    </div>

    <!-- 加载/错误/空态（AppEmpty 统一三件套） -->
    <div class="tabs">
      <button class="refresh-btn" :aria-pressed="tab === 'pending'" :disabled="saving" @click="switchTab('pending')">
        待审核
      </button>
      <button
        class="refresh-btn"
        :aria-pressed="tab === 'processed'"
        :disabled="saving"
        @click="switchTab('processed')"
      >
        已处理
      </button>
    </div>
    <AppEmpty
      v-if="loading || error || !list.length"
      :loading="loading"
      :error="error"
      :empty-text="tab === 'pending' ? '暂无待审批申请' : '暂无已处理记录'"
      icon="🪶"
      @retry="load"
    />

    <!-- 申请列表 -->
    <template v-if="!loading && !error && list.length">
      <div v-for="u in list" :key="u.id" class="app-card">
        <!-- 头像：点击跳转个人主页核实资料（UserAvatar 统一头像+兜底） -->
        <router-link :to="`/user/${u.user_id}`" class="avatar-link">
          <UserAvatar :src="u.avatar" :name="u.nickname || u.username || '?'" :size="46" />
        </router-link>
        <div style="flex: 1; min-width: 0">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
            <router-link :to="`/user/${u.user_id}`" class="user-name">{{ u.nickname || u.username }}</router-link>
            <span style="font-size: 0.72rem; color: var(--text-muted)">@{{ u.username }}</span>
            <span style="font-size: 0.72rem; color: var(--text-muted)"
              >申请 #{{ u.id }} ·
              {{
                u.submitted_at ? '提交于 ' + u.submitted_at.replace('T', ' ').slice(0, 16) : '历史申请，时间未记录'
              }}</span
            >
            <span v-if="u.user_status !== 1" class="banned">账号已封禁</span>
          </div>
          <div class="reason-title">申请理由</div>
          <div class="reason-text">{{ u.reason || '历史申请未填写理由' }}</div>
          <template v-if="u.status !== 'pending'">
            <p>
              {{ u.status === 'approved' ? '已通过' : '已驳回' }} · {{ u.reviewer_username || '历史审核人未记录' }} ·
              {{ u.reviewed_at?.replace('T', ' ').slice(0, 16) || '审核时间未记录' }}
            </p>
            <p v-if="u.status === 'rejected'" class="reason-text">
              驳回原因：{{ u.reject_reason || '历史记录未保存原因' }}
            </p>
          </template>
        </div>
        <div v-if="u.status === 'pending'" class="actions">
          <button class="action-btn danger" :disabled="saving" @click="openDecision(u, 'rejected')">驳回</button>
          <button
            class="action-btn primary"
            :disabled="saving || u.user_status !== 1"
            @click="openDecision(u, 'approved')"
          >
            ✓ 通过
          </button>
        </div>
      </div>

      <!-- 分页（AppPagination 统一控件） -->
      <AppPagination :page="page" :page-count="pageCount" @change="goPage" />
    </template>
    <AppModal
      :open="Boolean(selected)"
      :title="decision === 'approved' ? '通过创作者申请' : '驳回创作者申请'"
      @close="!saving && (selected = null)"
    ><template v-if="selected">
      <p>申请 #{{ selected.id }} · {{ selected.nickname || selected.username }}</p>
      <p v-if="decision === 'approved'">确认授予该用户创作者权限？</p>
      <textarea
        v-else
        v-model="reason"
        maxlength="500"
        rows="4"
        aria-label="驳回原因"
        placeholder="请说明需要改进的内容（必填，≤500 字）"
        :disabled="saving"
      />
      <p v-if="decisionError" role="alert" class="banned">{{ decisionError }}</p>
      <div class="actions">
        <button class="refresh-btn" :disabled="saving" @click="selected = null">取消</button>
        <button
          class="action-btn"
          :class="decision === 'approved' ? 'primary' : 'danger'"
          :disabled="saving"
          @click="confirmDecision"
        >
          {{ saving ? '处理中…' : '确认' }}
        </button>
      </div>
    </template></AppModal>
  </div>
</template>

<style scoped>
.tabs,
.actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.tabs [aria-pressed='true'] {
  color: var(--amber);
  border-color: var(--amber);
}
.banned {
  color: var(--red);
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  padding: 10px;
}
@media (max-width: 600px) {
  .app-card {
    flex-wrap: wrap;
  }
  .app-card > .actions {
    width: 100%;
    justify-content: flex-end;
  }
}
.badge {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.72rem;
  font-weight: 600;
  background: var(--amber-glow);
  color: var(--amber);
}
.refresh-btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.78rem;
  cursor: pointer;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-family: inherit;
  transition: all var(--transition-fast);
}
.refresh-btn:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.app-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  margin-bottom: 8px;
}
.avatar-link {
  flex-shrink: 0;
  text-decoration: none;
  display: inline-flex;
  transition: opacity var(--transition-fast);
}
.avatar-link:hover {
  opacity: 0.85;
}
.user-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  text-decoration: none;
  transition: color var(--transition-fast);
}
.user-name:hover {
  color: var(--amber);
}
.reason-title {
  margin-top: 8px;
  font-size: 0.7rem;
  color: var(--text-muted);
  font-weight: 600;
}
.reason-text {
  white-space: pre-wrap;
  margin-top: 2px;
  font-size: 0.85rem;
  color: var(--text-primary);
  line-height: 1.6;
  word-break: break-word;
}

.action-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  font-family: inherit;
  transition: opacity var(--transition-fast);
}
.action-btn:hover {
  opacity: 0.85;
}
.action-btn.primary {
  background: var(--green);
  color: #fff;
  font-weight: 600;
}
.action-btn.danger {
  background: var(--red);
  color: #fff;
}
</style>
