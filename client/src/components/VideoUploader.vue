<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import SparkMD5 from 'spark-md5'
import { mediaApi } from '../api'
import { toast } from '../utils/toast'

/**
 * 视频分片断点续传组件（D12/D13）
 * 契约：5MB/片、3 片并发、32 位 hex hash、≤100 片（500MB）
 * 流程：spark-md5 计算 hash → status 查询已传分片 → 并发补传 → merge → url
 * v-model：modelValue: string | null（上传完成 / 移除后 emit）
 */
defineOptions({ name: 'VideoUploader' })

const { modelValue } = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string | null): void; (e: 'busy', v: boolean): void }>()

const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB，与后端一致
const MAX_SIZE = 500 * 1024 * 1024 // 500MB（≤100 片）
const CONCURRENCY = 3
const ALLOWED = /\.(mp4|webm|mov|avi|mkv|flv)$/i

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const tip = ref('')
const progress = ref(0)
// 仅记录本次页面会话中新上传的临时资产；编辑已有视频时保持 null，避免误删已绑定资产。
const assetId = ref<number | null>(null)

async function setUploaded(url: string, nextAssetId: number | null) {
  const previousAssetId = assetId.value
  assetId.value = nextAssetId
  emit('update:modelValue', url)
  if (previousAssetId && previousAssetId !== nextAssetId) {
    await mediaApi.removeAsset(previousAssetId).catch(() => {})
  }
}

// 组件卸载标志：上传中离开写攻略页时，剩余分片不再继续上传、不发 emit/toast（原实现上传继续跑并 emit 到已卸载组件）。
// 已上传的分片保留在服务端 tmp，下次进入时断点续传继续（status 接口查到已传分片）。
let disposed = false
let controller: AbortController | null = null
onUnmounted(() => {
  disposed = true
  controller?.abort()
})

/** 增量计算文件 MD5 hash（2MB 切片读，避免大文件占满内存） */
function computeHash(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const spark = new SparkMD5.ArrayBuffer()
    const SLICE = 2 * 1024 * 1024
    let offset = 0
    const readNext = () => {
      if (disposed || controller?.signal.aborted) { spark.destroy(); reject(new Error('cancelled')); return }
      const reader = new FileReader()
      reader.onload = (e) => {
        spark.append(e.target!.result as ArrayBuffer)
        offset += SLICE
        if (offset < file.size) readNext()
        else resolve(spark.end())
      }
      reader.onerror = () => reject(new Error('计算文件哈希失败'))
      reader.readAsArrayBuffer(file.slice(offset, offset + SLICE))
    }
    readNext()
  })
}

async function upload(file: File) {
  if (uploading.value || disposed) return
  const task = new AbortController()
  controller = task
  uploading.value = true
  emit('busy', true)
  progress.value = 0
  try {
    tip.value = '正在计算文件哈希…'
    const hash = await computeHash(file)
    if (disposed) return // 组件已卸载，不再继续

    const { data: st } = await mediaApi.videoStatus(hash, task.signal)
    if (st.url) {
      if (disposed) return
      await setUploaded(st.url, st.asset_id)
      toast('视频已上传', 'success')
      return
    }

    const total = Math.ceil(file.size / CHUNK_SIZE)
    const done = new Set<number>(st.uploadedChunks || [])
    const queue: number[] = []
    for (let i = 0; i < total; i++) if (!done.has(i)) queue.push(i)
    tip.value = `共 ${total} 片，续传 ${done.size} 片，3 片并发上传中…`
    let finished = done.size
    let next = 0
    let failure: unknown
    const worker = async () => {
      try {
      while (next < queue.length) {
        if (disposed || task.signal.aborted) return
        const i = queue[next++]
        const chunk = file.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, file.size))
        await mediaApi.videoChunk(hash, i, total, chunk, file.name, task.signal)
        if (disposed || task.signal.aborted) return
        finished++
        progress.value = Math.round((finished / total) * 100)
      }
      } catch (err) {
        if (!task.signal.aborted) failure = err
        task.abort()
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    if (failure) throw failure
    if (task.signal.aborted) return
    if (disposed) return

    // 合并 + 转码阶段无进度反馈，明确提示避免误以为卡死（非 mp4 格式需 FFmpeg 转码，大文件可能数分钟）
    tip.value = '分片上传完成，正在合并与转码（请耐心等待，勿关闭页面）…'
    const { data: merge } = await mediaApi.videoMerge(hash, total, file.name, task.signal)
    if (disposed) return
    await setUploaded(merge.url, merge.asset_id)
    toast('视频上传完成', 'success')
  } catch (err: unknown) {
    if (disposed) return // 卸载中断：不提示（页面已离开）
    const message = err instanceof Error ? err.message : ''
    toast('视频上传失败：' + (message === 'cancelled' ? '已取消' : message || '网络错误'), 'error')
  } finally {
    uploading.value = false
    controller = null
    if (!disposed) emit('busy', false)
  }
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.size) return toast('不能上传空视频文件', 'error')
  // 云盘占位文件防御（契约 4.1 备忘 5）：仅当 type 非空且非 video/* 时拦截；
  // type 为空但扩展名合法 → 放行（后端扩展名白名单兜底，勿误伤本地未关联 MIME 的合法文件）
  if (file.type && !file.type.startsWith('video/')) {
    return toast('检测到云盘占位文件，请先将视频下载到本地后重试', 'error')
  }
  if (!ALLOWED.test(file.name)) return toast('仅支持 mp4/webm/mov/avi/mkv/flv 格式', 'error')
  if (file.size > MAX_SIZE) return toast('视频不能超过 500MB', 'error')
  upload(file)
}

async function remove() {
  const temporaryAssetId = assetId.value
  assetId.value = null
  emit('update:modelValue', null)
  if (temporaryAssetId) {
    try {
      await mediaApi.removeAsset(temporaryAssetId)
    } catch {
      // 失败时后端仍会按临时资产过期时间回收，不阻断用户继续编辑。
      toast('视频已从文章移除，临时文件将在稍后自动清理', 'info')
    }
  }
}
</script>

<template>
  <div class="video-uploader">
    <div v-if="uploading" class="vz-uploading">
      <div class="vz-progress"><div class="vz-progress-fill" :style="{ width: progress + '%' }"></div></div>
      <div class="vz-tip">{{ tip }} · {{ progress }}%</div>
    </div>
    <div v-else-if="modelValue" class="vz-preview">
      <video :src="modelValue || undefined" controls preload="metadata"></video>
      <div class="vz-actions">
        <button class="vz-btn" @click="fileInput?.click()">替换视频</button>
        <button class="vz-btn vz-btn-danger" @click="remove">移除</button>
      </div>
    </div>
    <div v-else class="vz-empty" @click="fileInput?.click()">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none" />
      </svg>
      <span>上传主视频（可选，将展示在标题之后）</span>
      <small>mp4 / webm / mov / avi / mkv / flv，≤500MB，支持断点续传</small>
    </div>
    <input ref="fileInput" type="file" accept="video/*" hidden @change="onPick" />
  </div>
</template>

<style scoped>
.video-uploader {
  margin-bottom: 14px;
}

.vz-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 140px;
  border: 1px dashed var(--border-hover);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.vz-empty:hover {
  border-color: var(--amber);
  background: var(--bg-hover);
}
.vz-empty svg {
  width: 34px;
  height: 34px;
  color: var(--amber);
}
.vz-empty small {
  color: var(--text-muted);
  font-size: 0.75rem;
}

.vz-uploading {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px 16px;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
}
.vz-progress {
  height: 6px;
  border-radius: 3px;
  background: var(--bg-main);
  overflow: hidden;
}
.vz-progress-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--amber);
  transition: width 0.2s ease;
}
.vz-tip {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.vz-preview video {
  width: 100%;
  aspect-ratio: 16 / 9;
  display: block;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
}
.vz-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.vz-btn {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}
.vz-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.vz-btn-danger {
  color: var(--red);
}
</style>
