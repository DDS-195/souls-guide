<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminApi } from '../../api'
import { toast } from '../../utils/toast'

const list = ref<any[]>([])
const showForm = ref(false)
const editing = ref<any>(null)
const form = ref({ title: '', content: '' })
const loadError = ref('')

onMounted(load)

function errMsg(e: any, fallback: string) {
  return e?.response?.data?.message || fallback
}

async function load() {
  try {
    const r = await adminApi.getAnnouncements()
    list.value = r.data
    loadError.value = ''
  } catch (e: any) {
    loadError.value = errMsg(e, '加载失败，请重试')
  }
}

function openCreate() {
  editing.value = null
  form.value = { title: '', content: '' }
  showForm.value = true
}

function openEdit(a: any) {
  editing.value = a.id
  form.value = { title: a.title, content: a.content }
}

// 新增公告保存（openCreate 表单用；行内编辑走 saveEdit）
async function save() {
  if (!form.value.title) return
  try {
    await adminApi.createAnnouncement(form.value)
    showForm.value = false
    toast('创建成功', 'success')
    load()
  } catch (e: any) {
    toast(errMsg(e, '创建失败'), 'error')
  }
}

async function saveEdit(id: number) {
  if (!form.value.title) return
  try {
    await adminApi.updateAnnouncement(id, form.value)
    editing.value = null
    toast('已保存', 'success')
    load()
  } catch (e: any) {
    toast(errMsg(e, '保存失败'), 'error')
  }
}

async function publish(id: number) {
  try {
    await adminApi.publishAnnouncement(id)
    toast('已发布', 'success')
    load()
  } catch (e: any) {
    toast(errMsg(e, '发布失败'), 'error')
  }
}

async function archive(id: number) {
  try {
    await adminApi.archiveAnnouncement(id)
    toast('已归档', 'success')
    load()
  } catch (e: any) {
    toast(errMsg(e, '归档失败'), 'error')
  }
}

async function remove(id: number) {
  try {
    await adminApi.deleteAnnouncement(id)
    toast('已删除', 'success')
    load()
  } catch (e: any) {
    toast(errMsg(e, '删除失败'), 'error')
  }
}

const statusMap: any = { published: '已发布', draft: '草稿', archived: '已归档' }
</script>

<template>
  <div style="max-width: 900px; margin: 0 auto; padding: 20px; color: var(--text-primary)">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
      <h2 style="font-family: Cinzel, serif; color: var(--amber)">公告管理</h2>
      <button class="btn-amber" @click="openCreate">新增公告</button>
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

    <!-- 编辑表单 -->
    <div
      v-if="showForm"
      style="
        margin-bottom: 20px;
        padding: 20px;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: 10px;
      "
    >
      <h4 style="margin-bottom: 12px; color: var(--amber)">{{ editing ? '编辑公告' : '新增公告' }}</h4>
      <input
        v-model="form.title"
        placeholder="公告标题"
        style="
          width: 100%;
          padding: 10px;
          background: var(--bg-sidebar);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          color: var(--text-primary);
          margin-bottom: 8px;
          font-family: inherit;
        "
      />
      <textarea
        v-model="form.content"
        placeholder="公告内容"
        rows="4"
        style="
          width: 100%;
          padding: 10px;
          background: var(--bg-sidebar);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          color: var(--text-primary);
          font-family: inherit;
          resize: vertical;
          margin-bottom: 8px;
        "
      ></textarea>
      <div style="display: flex; gap: 8px">
        <button class="btn-amber" @click="save">保存</button>
        <button
          style="
            padding: 8px 20px;
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            color: var(--text-secondary);
            cursor: pointer;
          "
          @click="showForm = false"
        >
          取消
        </button>
      </div>
    </div>

    <!-- 列表 -->
    <div
      v-for="a in list"
      :key="a.id"
      style="
        padding: 14px 16px;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: 8px;
        margin-bottom: 8px;
      "
    >
      <!-- 编辑模式 -->
      <div v-if="editing === a.id">
        <input
          v-model="form.title"
          style="
            width: 100%;
            padding: 8px;
            background: var(--bg-sidebar);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            color: var(--text-primary);
            margin-bottom: 6px;
            font-family: inherit;
          "
        />
        <textarea
          v-model="form.content"
          rows="3"
          style="
            width: 100%;
            padding: 8px;
            background: var(--bg-sidebar);
            border: 1px solid var(--border-subtle);
            border-radius: 6px;
            color: var(--text-primary);
            font-family: inherit;
            resize: vertical;
            margin-bottom: 6px;
          "
        ></textarea>
        <div style="display: flex; gap: 6px">
          <button class="btn-green" @click="saveEdit(a.id)">保存</button>
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
      </div>
      <!-- 查看模式 -->
      <div v-else style="display: flex; justify-content: space-between; align-items: flex-start">
        <div style="flex: 1">
          <div style="display: flex; align-items: center; gap: 8px">
            <span style="font-weight: 600">{{ a.title }}</span>
            <span class="status-tag" :class="a.status === 'published' ? 'on' : 'off'">{{ statusMap[a.status] }}</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px">
            {{ a.content?.slice(0, 80) }}{{ a.content?.length > 80 ? '...' : '' }}
          </div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px">
            {{ a.created_at?.slice(0, 10) }}
          </div>
        </div>
        <div style="display: flex; gap: 6px; flex-shrink: 0">
          <button
            style="
              padding: 4px 10px;
              background: var(--bg-card);
              border: 1px solid var(--border-subtle);
              border-radius: 5px;
              color: var(--text-secondary);
              cursor: pointer;
              font-size: 0.75rem;
            "
            @click="openEdit(a)"
          >
            编辑
          </button>
          <button v-if="a.status !== 'published'" class="btn-amber-ghost" @click="publish(a.id)">发布</button>
          <button
            v-if="a.status === 'published'"
            style="
              padding: 4px 10px;
              background: var(--bg-card);
              border: 1px solid var(--border-subtle);
              border-radius: 5px;
              color: var(--text-muted);
              cursor: pointer;
              font-size: 0.75rem;
            "
            @click="archive(a.id)"
          >
            归档
          </button>
          <button
            style="
              padding: 4px 10px;
              background: var(--bg-card);
              border: 1px solid var(--border-subtle);
              border-radius: 5px;
              color: var(--red);
              cursor: pointer;
              font-size: 0.75rem;
            "
            @click="remove(a.id)"
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
  padding: 6px 16px;
  background: var(--green);
  border: none;
  border-radius: 5px;
  color: #fff;
  cursor: pointer;
  font-size: 0.8rem;
}
.btn-green:hover {
  opacity: 0.85;
}
.btn-amber-ghost {
  padding: 4px 10px;
  background: rgba(232, 168, 56, 0.12);
  border: 1px solid rgba(232, 168, 56, 0.2);
  border-radius: 5px;
  color: var(--amber);
  cursor: pointer;
  font-size: 0.75rem;
}
.btn-amber-ghost:hover {
  background: rgba(232, 168, 56, 0.25);
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
