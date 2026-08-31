<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { gameApi, adminApi } from '../../api'
import { toast } from '../../utils/toast'

const games = ref<any[]>([])
const showAdd = ref(false)
const newGame = ref({ name: '', description: '' })
const editing = ref<any>(null)
const editForm = ref({ name: '', description: '' })
const loadError = ref('')

onMounted(load)

// 管理端列表（含停用，D15 契约 GET /admin/games）
async function load() {
  try {
    const r = await adminApi.getAdminGames()
    games.value = r.data
    loadError.value = ''
  } catch (e: any) {
    loadError.value = errMsg(e, '加载失败，请重试')
  }
}

function errMsg(e: any, fallback: string) {
  return e?.response?.data?.message || fallback
}

async function addGame() {
  if (!newGame.value.name) return
  try {
    await gameApi.create(newGame.value)
    toast('创建成功', 'success')
    newGame.value = { name: '', description: '' }
    showAdd.value = false
    load()
  } catch (e: any) {
    toast(errMsg(e, '创建失败'), 'error')
  }
}

function openEdit(g: any) {
  editing.value = g.id
  editForm.value = { name: g.name, description: g.description }
}

async function saveEdit(id: number) {
  if (!editForm.value.name) return
  try {
    await gameApi.update(id, editForm.value)
    toast('已保存', 'success')
    editing.value = null
    load()
  } catch (e: any) {
    toast(errMsg(e, '保存失败'), 'error')
  }
}

async function toggleStatus(g: any) {
  try {
    await gameApi.update(g.id, { name: g.name, description: g.description, status: g.status ? 0 : 1 })
    toast(g.status ? '已停用' : '已启用', 'success')
    load()
  } catch (e: any) {
    toast(errMsg(e, '操作失败'), 'error')
  }
}

async function remove(g: any) {
  if (!confirm(`确定删除「${g.name}」？`)) return
  try {
    await gameApi.remove(g.id)
    toast('删除成功', 'success')
    load()
  } catch (e: any) {
    // RESTRICT：该游戏下已有文章时后端返回 400 业务文案
    toast(errMsg(e, '删除失败'), 'error')
  }
}

// 上移/下移：交换相邻 sort_order 后批量提交
async function move(g: any, dir: -1 | 1) {
  const idx = games.value.findIndex((x) => x.id === g.id)
  const j = idx + dir
  if (idx < 0 || j < 0 || j >= games.value.length) return
  const next = games.value.map((x) => ({ ...x }))
  const a = next[idx]
  next[idx] = next[j]
  next[j] = a
  try {
    await gameApi.sort(next.map((x, i) => ({ id: x.id, sort_order: i + 1 })))
    load()
  } catch (e: any) {
    toast(errMsg(e, '排序失败'), 'error')
  }
}
</script>

<template>
  <div style="max-width: 900px; margin: 0 auto; padding: 20px; color: var(--text-primary)">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
      <h2 style="font-family: Cinzel, serif; color: var(--amber)">游戏管理</h2>
      <button class="btn-amber" @click="showAdd = !showAdd">新增游戏</button>
    </div>

    <!-- 加载错误态 -->
    <div v-if="loadError" style="text-align: center; padding: 60px; color: var(--text-muted)">
      <div style="margin-bottom: 12px">{{ loadError }}</div>
      <button
        style="
          padding: 6px 16px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 0.8rem;
          font-family: inherit;
        "
        @click="load"
      >
        重新加载
      </button>
    </div>

    <div v-if="showAdd" style="display: flex; gap: 8px; margin-bottom: 16px">
      <input
        v-model="newGame.name"
        placeholder="游戏名"
        style="
          flex: 1;
          padding: 10px;
          background: var(--bg-sidebar);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          color: var(--text-primary);
        "
      />
      <input
        v-model="newGame.description"
        placeholder="简介"
        style="
          flex: 2;
          padding: 10px;
          background: var(--bg-sidebar);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          color: var(--text-primary);
        "
      />
      <button class="btn-green" @click="addGame">添加</button>
    </div>

    <div
      v-for="g in games"
      :key="g.id"
      style="
        padding: 12px 16px;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        margin-bottom: 6px;
      "
    >
      <!-- 编辑模式 -->
      <div v-if="editing === g.id" style="display: flex; gap: 8px; align-items: center">
        <input
          v-model="editForm.name"
          placeholder="游戏名"
          style="
            flex: 1;
            padding: 8px;
            background: var(--bg-sidebar);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            color: var(--text-primary);
          "
        />
        <input
          v-model="editForm.description"
          placeholder="简介"
          style="
            flex: 2;
            padding: 8px;
            background: var(--bg-sidebar);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            color: var(--text-primary);
          "
        />
        <button class="btn-green" @click="saveEdit(g.id)">保存</button>
        <button
          style="
            padding: 6px 16px;
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: 5px;
            color: var(--text-secondary);
            cursor: pointer;
            font-size: 0.8rem;
          "
          @click="editing = null"
        >
          取消
        </button>
      </div>
      <!-- 查看模式 -->
      <div v-else style="display: flex; justify-content: space-between; align-items: center">
        <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0">
          <strong style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{{ g.name }}</strong>
          <span
            style="
              color: var(--text-muted);
              font-size: 0.8rem;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            "
            >{{ g.description }}</span
          >
          <span class="status-tag" :class="g.status ? 'on' : 'off'">{{ g.status ? '启用' : '停用' }}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0">
          <span style="color: var(--text-muted); font-size: 0.75rem">排序: {{ g.sort_order }}</span>
          <button
            title="上移"
            style="
              padding: 4px 10px;
              background: var(--bg-sidebar);
              border: 1px solid var(--border-subtle);
              border-radius: 5px;
              color: var(--text-secondary);
              cursor: pointer;
              font-size: 0.8rem;
            "
            @click="move(g, -1)"
          >
            ↑
          </button>
          <button
            title="下移"
            style="
              padding: 4px 10px;
              background: var(--bg-sidebar);
              border: 1px solid var(--border-subtle);
              border-radius: 5px;
              color: var(--text-secondary);
              cursor: pointer;
              font-size: 0.8rem;
            "
            @click="move(g, 1)"
          >
            ↓
          </button>
          <button
            style="
              padding: 4px 10px;
              background: var(--bg-sidebar);
              border: 1px solid var(--border-subtle);
              border-radius: 5px;
              color: var(--text-secondary);
              cursor: pointer;
              font-size: 0.8rem;
            "
            @click="toggleStatus(g)"
          >
            {{ g.status ? '停用' : '启用' }}
          </button>
          <button
            style="
              padding: 4px 10px;
              background: var(--bg-sidebar);
              border: 1px solid var(--border-subtle);
              border-radius: 5px;
              color: var(--text-secondary);
              cursor: pointer;
              font-size: 0.8rem;
            "
            @click="openEdit(g)"
          >
            编辑
          </button>
          <button
            style="
              padding: 4px 10px;
              background: var(--bg-sidebar);
              border: 1px solid var(--border-subtle);
              border-radius: 5px;
              color: var(--red);
              cursor: pointer;
              font-size: 0.8rem;
            "
            @click="remove(g)"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.btn-amber {
  padding: 8px 18px;
  background: var(--amber);
  border: none;
  border-radius: 8px;
  color: var(--on-amber);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.85rem;
}
.btn-amber:hover {
  background: var(--amber-dim);
}
.btn-green {
  padding: 10px 20px;
  background: var(--green);
  border: none;
  border-radius: 8px;
  color: #fff;
  cursor: pointer;
  font-size: 0.85rem;
}
.btn-green:hover {
  opacity: 0.85;
}
.status-tag {
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 0.65rem;
}
.status-tag.on {
  background: rgba(90, 158, 111, 0.15);
  color: var(--green);
}
.status-tag.off {
  background: var(--bg-hover);
  color: var(--text-muted);
}
</style>
