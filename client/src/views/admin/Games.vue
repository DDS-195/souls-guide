<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useCardReorder } from '../../composables/useCardReorder'
import { gameApi, adminApi } from '../../api'
import { toast } from '../../utils/toast'
import { errorMessage } from '../../utils/errors'
import AppEmpty from '../../components/AppEmpty.vue'
import AppModal from '../../components/AppModal.vue'
import type { Game } from '../../types/api'

const games = ref<Game[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const modal = ref<'create' | 'edit' | 'status' | 'delete' | null>(null)
const selected = ref<Game | null>(null)
const form = ref({ name: '', description: '' })
const formError = ref('')
const sortNotice = ref('')
const {
  list: sortList,
  activeId,
  active: sorting,
  settling,
  announcement,
  style: cardStyle,
  start: startSort,
  keyboard: keyboardSort,
} = useCardReorder(games, () => busy.value || loading.value || !!error.value || !!modal.value, persistOrder)
let alive = true
function setSortList(element: unknown) {
  sortList.value = element instanceof HTMLElement ? element : null
}
let requestId = 0
async function load() {
  const ticket = ++requestId
  loading.value = true
  error.value = ''
  try {
    const r = await adminApi.getAdminGames()
    if (ticket === requestId) games.value = r.data
  } catch (e) {
    if (ticket === requestId) error.value = errorMessage(e, '加载失败，请重试')
  } finally {
    if (ticket === requestId) loading.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => {
  requestId++
  alive = false
})
function open(kind: 'create' | 'edit' | 'status' | 'delete', game: Game | null = null) {
  selected.value = game ? { ...game } : null
  form.value = { name: game?.name || '', description: game?.description || '' }
  formError.value = ''
  modal.value = kind
}
function close() {
  if (!busy.value) modal.value = null
}
async function save() {
  if (busy.value) return
  const kind = modal.value
  const game = selected.value
  if (kind === 'create' || kind === 'edit') {
    if (!form.value.name.trim() || form.value.name.trim().length > 50 || form.value.description.length > 500) {
      formError.value = '名称必填且不超过 50 字，简介不超过 500 字'
      return
    }
  }
  busy.value = true
  formError.value = ''
  try {
    const fields = { name: form.value.name.trim(), description: form.value.description.trim() }
    if (kind === 'create') await gameApi.create(fields)
    else if (game && kind === 'edit') await gameApi.update(game.id, { ...fields, version: game.version })
    else if (game && kind === 'status')
      await gameApi.update(game.id, { status: game.status === 1 ? 0 : 1, version: game.version })
    else if (game && kind === 'delete') await gameApi.remove(game.id, game.version)
    else return
    modal.value = null
    toast('操作成功', 'success')
    await load()
  } catch (e) {
    formError.value = errorMessage(e, '操作失败，请重试')
    // 刷新列表但不改变弹窗中的版本，防止未重新审阅就覆盖新数据。
    await load()
  } finally {
    busy.value = false
  }
}
async function persistOrder(next: Game[], previous: Game[]) {
  if (busy.value || loading.value) return
  busy.value = true
  sortNotice.value = '正在保存顺序…'
  games.value = next
  let saved = false
  try {
    await gameApi.sort(next.map((g, i) => ({ id: g.id, sort_order: i + 1, version: g.version })))
    saved = true
    if (!alive) return
    games.value = next.map((g, i) => ({ ...g, sort_order: i + 1, version: g.version + 1 }))
    sortNotice.value = '顺序已保存'
  } catch (e) {
    if (!alive) return
    games.value = previous
    sortNotice.value = '保存失败，已恢复原顺序'
    toast(errorMessage(e, '排序失败，请重试'), 'error')
  }
  // 静默核对版本，不卸载列表，保留落位动画和焦点。
  if (alive) {
    try {
      const result = await adminApi.getAdminGames()
      if (alive) games.value = result.data
    } catch {
      if (alive && !saved) error.value = '无法确认最新顺序，请刷新后重试'
    } finally {
      busy.value = false
    }
  }
}
</script>

<template>
  <div class="games-page">
    <div class="heading">
      <h2>游戏管理</h2>
      <div class="actions">
        <button :disabled="loading || busy || sorting" @click="load">刷新</button>
        <button class="primary" :disabled="loading || busy || sorting || !!error" @click="open('create')">
          新增游戏
        </button>
      </div>
    </div>
    <p class="hint">停用后不能新增文章归属，历史文章和统计仍保留；已有文章的游戏不可删除。</p>
    <AppEmpty
      v-if="loading || error || !games.length"
      :loading="loading"
      :error="error"
      empty-text="暂无游戏，请新增"
      @retry="load"
    />
    <div v-else :ref="setSortList" class="game-list" :class="{ 'is-sorting': sorting, 'is-settling': settling }">
      <article
        v-for="(game, index) in games"
        :key="game.id"
        data-sort-card
        class="game-card"
        :class="{ 'is-picked': activeId === game.id }"
        :style="cardStyle(index)"
      >
        <button
          class="drag-handle"
          :disabled="busy"
          :aria-label="'拖动排序：' + game.name"
          aria-describedby="sort-instructions"
          @pointerdown="startSort($event, game.id)"
          @keydown="keyboardSort($event, index)"
          @dragstart.prevent
        >
          <svg width="18" height="24" viewBox="0 0 18 24" fill="currentColor" aria-hidden="true">
            <circle v-for="n in 6" :key="n" :cx="n % 2 ? 6 : 12" :cy="5 + Math.floor((n - 1) / 2) * 7" r="1.6" />
          </svg>
        </button>
        <div class="game-info">
          <div class="game-title">
            <span class="order-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <h3 :title="game.name">{{ game.name }}</h3>
            <span class="status" :class="{ inactive: game.status !== 1 }">{{
              game.status === 1 ? '启用' : '停用'
            }}</span>
          </div>
          <p class="description" :title="game.description || ''">{{ game.description || '暂无简介' }}</p>
          <div class="footer">
            <span class="article-count">{{ game.post_count || 0 }} 篇文章</span>
            <div class="actions">
              <button :disabled="busy || sorting" @click="open('status', game)">
                {{ game.status === 1 ? '停用' : '启用' }}
              </button>
              <button :disabled="busy || sorting" @click="open('edit', game)">编辑</button>
              <button
                class="danger"
                :disabled="busy || sorting || !!game.post_count"
                :title="game.post_count ? '已有文章，不可删除，可停用' : '删除游戏'"
                @click="open('delete', game)"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      </article>
    </div>
    <p id="sort-instructions" class="hint sort-help">按住左侧手柄拖动排序，也可聚焦手柄后按 ↑ ↓ 调整。</p>
    <p class="sort-notice" role="status">{{ sorting ? announcement : sortNotice }}</p>
    <AppModal
      :open="Boolean(modal)"
      :title="
        modal === 'create'
          ? '新增游戏'
          : modal === 'edit'
            ? '编辑游戏'
            : modal === 'delete'
              ? '删除游戏'
              : '修改游戏状态'
      "
      @close="close"
    ><template v-if="modal">
      <template v-if="modal === 'create' || modal === 'edit'">
        <label>游戏名称<input v-model="form.name" maxlength="50" :disabled="busy" /></label>
        <label>简介<textarea v-model="form.description" maxlength="500" rows="4" :disabled="busy" /></label>
      </template>
      <p v-else-if="modal === 'delete'">确定删除「{{ selected?.name }}」？此操作不可撤销。有文章关联时将禁止删除。</p>
      <p v-else>
        确定{{ selected?.status === 1 ? '停用' : '启用' }}「{{ selected?.name }}」？停用仅限制新增归属，不下架历史文章。
      </p>
      <p v-if="formError" class="danger" role="alert">{{ formError }}；若提示版本变化，请取消后重新打开。</p>
      <div class="actions modal-actions">
        <button :disabled="busy" @click="close">取消</button>
        <button class="primary" :disabled="busy" @click="save">{{ busy ? '处理中…' : '确认' }}</button>
      </div>
    </template></AppModal>
  </div>
</template>

<style scoped>
.games-page {
  max-width: 900px;
  margin: auto;
  padding: 20px 16px 40px;
  color: var(--text-primary);
}
.heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  flex-wrap: wrap;
}
.heading .actions {
  gap: 12px;
  margin-left: auto;
}
.heading .actions button {
  min-height: 38px;
  padding: 8px 16px;
  white-space: nowrap;
}
.heading + .hint {
  margin: 18px 0 20px;
  line-height: 1.8;
}
h2 {
  color: var(--amber);
  margin: 0;
}
h3 {
  margin: 0;
  font-size: 1rem;
  overflow-wrap: anywhere;
}
.hint {
  color: var(--text-muted);
  font-size: 0.8rem;
  line-height: 1.6;
}
.game-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.game-card {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  padding: 10px 12px;
  border-radius: 9px;
  transition:
    box-shadow 180ms ease,
    border-color 180ms ease;
}
.game-card.is-picked {
  z-index: 5;
  border-color: var(--amber);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.24);
}
.is-sorting .game-card {
  transition:
    transform 180ms cubic-bezier(0.2, 0.75, 0.25, 1),
    box-shadow 180ms ease,
    border-color 180ms ease;
  will-change: transform;
  user-select: none;
}
.is-sorting:not(.is-settling) .game-card.is-picked {
  transition:
    box-shadow 180ms ease,
    border-color 180ms ease;
}
button.drag-handle {
  padding: 0;
  width: 32px;
  min-height: 44px;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border-color: transparent;
  color: var(--text-muted);
  cursor: grab;
  touch-action: none;
}
button.drag-handle:hover,
.is-picked .drag-handle {
  background: var(--amber-glow);
  color: var(--amber);
}
.is-picked .drag-handle {
  cursor: grabbing;
}
.game-info {
  min-width: 0;
}
.game-title {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 44px;
  align-items: center;
  gap: 10px;
  min-height: 24px;
}
.game-title h3 {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.order-number {
  color: var(--text-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.description {
  margin: 3px 0 7px;
  height: 1.4em;
  line-height: 1.4;
  font-size: 0.85rem;
  color: var(--text-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding-top: 0;
}
.article-count {
  color: var(--text-muted);
  white-space: nowrap;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}
.footer .actions {
  display: grid;
  grid-template-columns: repeat(3, 52px);
  gap: 6px;
}
.footer .actions button {
  padding: 4px 0;
  min-height: 32px;
}
.sort-help {
  margin-bottom: 0;
}
.sort-notice {
  min-height: 1.5em;
  margin: 4px 0 0;
  color: var(--amber);
  font-size: 0.8rem;
}
@media (prefers-reduced-motion: reduce) {
  .game-card {
    transition: none !important;
  }
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
button {
  padding: 7px 11px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-sidebar);
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 2px;
}
.primary {
  background: var(--amber);
  color: var(--on-amber);
}
.danger {
  color: var(--red);
}
.status {
  color: var(--green);
  background: var(--bg-hover);
  padding: 3px 0;
  text-align: center;
  border-radius: 5px;
  font-size: 0.75rem;
  white-space: nowrap;
}
.inactive {
  color: var(--text-muted);
}
label {
  display: block;
  margin: 12px 0;
}
input,
textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 6px;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-sidebar);
  color: var(--text-primary);
  font: inherit;
}
.modal-actions {
  justify-content: flex-end;
  margin-top: 16px;
}
@media (max-width: 420px) {
  .game-card {
    padding: 12px;
    gap: 8px;
    grid-template-columns: 28px minmax(0, 1fr);
  }
  button.drag-handle {
    width: 28px;
  }
  .game-title {
    gap: 6px;
    grid-template-columns: 20px minmax(0, 1fr) 40px;
  }
  .footer .actions {
    grid-template-columns: repeat(3, 44px);
    gap: 4px;
  }
}
</style>
