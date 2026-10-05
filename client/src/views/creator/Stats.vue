<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import type { ECharts } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { creatorApi, gameApi } from '../../api'
import { errorMessage } from '../../utils/errors'
import { useTheme } from '../../utils/theme'
import type { CreatorRankMetric, CreatorStats, CreatorTrendMetric, Game } from '../../types/api'

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])
const { isDark } = useTheme()

const CATEGORIES = ['BOSS攻略', '新手入门', '剧情解析', '装备评测', '全收集', 'Build分享']
const TREND_METRICS: Record<CreatorTrendMetric, string> = {
  uv: '阅读人数',
  pv: '阅读次数',
  favorites_net: '净增收藏',
  followers_net: '净增粉丝',
  likes_net: '净增点赞',
  comments_net: '净增评论',
}
const RANK_METRICS: Record<CreatorRankMetric, string> = {
  uv: '阅读人数',
  pv: '阅读次数',
  favorites_added: '新增收藏',
  likes_added: '新增点赞',
  comments_added: '新增评论',
  engagement_rate: '读者互动率',
}

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const today = ref(todayInShanghai())
const from = ref(shiftDate(today.value, -29))
const to = ref(today.value)
const gameId = ref('')
const category = ref('')
const filtersOpen = ref(false)
const games = ref<Game[]>([])
const gamesError = ref(false)
const stats = ref<CreatorStats | null>(null)
const loading = ref(true)
const error = ref('')
const filterError = ref('')
const trendMetric = ref<CreatorTrendMetric>('uv')
const rankBy = ref<CreatorRankMetric>('uv')
const showAllPosts = ref(false)
let requestId = 0
const trendRef = ref<HTMLDivElement | null>(null)
let trendChart: ECharts | null = null
let resizeObserver: ResizeObserver | null = null

const overviewItems = computed(() => {
  if (!stats.value) return []
  const p = stats.value.period
  return [
    { label: '阅读人数', value: p.uv, key: 'uv' as const, percent: false },
    { label: '净增收藏', value: p.favorites_net, key: 'favorites_net' as const, percent: false },
    { label: '净增粉丝', value: p.followers_net, key: 'followers_net' as const, percent: false },
    { label: '阅读用户互动率', value: p.engagement_rate, key: 'engagement_rate' as const, percent: true },
  ]
})
const snapshotItems = computed(() => {
  const c = stats.value?.current
  return c
    ? ([
        ['已发布文章', c.published_posts],
        ['当前粉丝', c.followers],
        ['有效点赞', c.active_likes],
        ['有效收藏', c.active_favorites],
        ['有效评论', c.active_comments],
        ['历史累计浏览', c.legacy_lifetime_views],
      ] as const)
    : []
})
const visiblePosts = computed(() => stats.value?.top_posts.slice(0, showAllPosts.value ? 10 : 5) || [])
const appliedScope = computed(() => {
  const f = stats.value?.meta.filters
  if (!f) return ''
  return [f.game_id ? games.value.find((g) => g.id === f.game_id)?.name || '已选游戏' : '', f.category]
    .filter(Boolean)
    .join(' · ')
})
const extraRankColumn = computed(() => ['pv', 'likes_added', 'comments_added'].includes(rankBy.value))
const comparisonComplete = computed(() => {
  if (!stats.value) return false
  const { from, to, data_since } = stats.value.meta
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1
  return shiftDate(from, -days) >= data_since
})

function comparisonText(key: CreatorTrendMetric | 'engagement_rate') {
  if (!stats.value) return ''
  if (!comparisonComplete.value) return '上期记录不完整，暂不比较'
  const item = stats.value.comparison[key]
  const diff = item.current - item.previous
  if (key === 'engagement_rate') return `较上期 ${diff > 0 ? '+' : ''}${diff.toFixed(2)} 个百分点`
  if (key !== 'pv' && key !== 'uv') return `较上期 ${diff > 0 ? '+' : ''}${diff.toLocaleString()}`
  if (item.change_percent === null) return '上期为 0，暂无增幅'
  return `较上期 ${item.change_percent > 0 ? '+' : ''}${item.change_percent}%`
}
function comparisonClass(key: CreatorTrendMetric | 'engagement_rate') {
  if (!comparisonComplete.value) return ''
  const c = stats.value?.comparison[key]
  return c && c.current !== c.previous ? (c.current > c.previous ? 'positive' : 'negative') : ''
}
function isPreset(days: number) {
  return stats.value?.meta.to === today.value && stats.value.meta.from === shiftDate(today.value, 1 - days)
}

function renderTrend() {
  const css = getComputedStyle(document.documentElement)
  const color = (name: string) => css.getPropertyValue(name).trim()
  if (!trendRef.value || !stats.value) return
  trendChart ||= echarts.init(trendRef.value)
  const rows = stats.value.trend
  trendChart.setOption(
    {
      tooltip: {
        backgroundColor: color('--bg-card'),
        borderColor: color('--border-subtle'),
        textStyle: { color: color('--text-primary') },
        trigger: 'axis',
        valueFormatter: (v: number) => v.toLocaleString(),
      },
      grid: { left: 8, right: 18, top: 20, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: rows.map((r) => r.date),
        axisLabel: { color: color('--text-secondary'), formatter: (v: string) => v.slice(5) },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: color('--text-secondary') },
        splitLine: { lineStyle: { color: color('--border-subtle') } },
      },
      series: [
        {
          name: TREND_METRICS[trendMetric.value],
          type: 'line',
          smooth: false,
          showSymbol: rows.length <= 31,
          symbolSize: 5,
          data: rows.map((r) => r[trendMetric.value]),
          lineStyle: { width: 2, color: color('--amber') },
          itemStyle: { color: color('--amber') },
          areaStyle: { color: color('--amber'), opacity: 0.06 },
        },
      ],
    },
    true,
  )
}

// 加载态会卸载图表容器；跟随容器创建和销毁实例，避免刷新后向旧 DOM 绘图。
watch(
  trendRef,
  (element) => {
    resizeObserver?.disconnect()
    trendChart?.dispose()
    trendChart = null
    if (element) {
      renderTrend()
      resizeObserver = new ResizeObserver(() => trendChart?.resize())
      resizeObserver.observe(element)
    }
  },
  { flush: 'post' },
)
watch([trendMetric, isDark], renderTrend, { flush: 'post' })

async function loadStats(applyDraft = false) {
  today.value = todayInShanghai()
  const applied = stats.value?.meta
  const query =
    applyDraft || !applied
      ? {
          from: from.value,
          to: to.value,
          game_id: gameId.value ? Number(gameId.value) : undefined,
          category: category.value || undefined,
        }
      : {
          from: applied.from,
          to: applied.to,
          game_id: applied.filters.game_id || undefined,
          category: applied.filters.category || undefined,
        }
  if (!query.from || !query.to || query.from > query.to || query.to > today.value) {
    filterError.value = '请选择有效日期范围，结束日期不能晚于今天'
    return
  }
  filterError.value = ''
  const currentRequest = ++requestId
  loading.value = true
  error.value = ''
  try {
    const response = await creatorApi.getStats({ ...query, rank_by: rankBy.value })
    if (currentRequest !== requestId) return
    stats.value = response.data
    showAllPosts.value = false
    if (applyDraft) filtersOpen.value = false
  } catch (e) {
    if (currentRequest === requestId) error.value = errorMessage(e, '统计暂不可用，请稍后重试')
  } finally {
    if (currentRequest === requestId) {
      loading.value = false
      await nextTick()
      renderTrend()
    }
  }
}
function usePreset(days: number) {
  today.value = todayInShanghai()
  from.value = shiftDate(today.value, 1 - days)
  to.value = today.value
  gameId.value = String(stats.value?.meta.filters.game_id || '')
  category.value = stats.value?.meta.filters.category || ''
  void loadStats(true)
}
function openFilters() {
  if (!filtersOpen.value && stats.value) {
    from.value = stats.value.meta.from
    to.value = stats.value.meta.to
    gameId.value = String(stats.value.meta.filters.game_id || '')
    category.value = stats.value.meta.filters.category || ''
  }
  filtersOpen.value = !filtersOpen.value
}
onMounted(() => {
  void loadStats()
  void gameApi
    .getList(true)
    .then((r) => {
      games.value = r.data
    })
    .catch(() => {
      gamesError.value = true
    })
})
onBeforeUnmount(() => {
  requestId++
  resizeObserver?.disconnect()
  trendChart?.dispose()
})
</script>

<template>
  <main class="stats-page">
    <header class="heading">
      <div>
        <h2>数据统计</h2>
        <p>了解近期表现，找到值得继续创作的内容。</p>
      </div>
      <div class="toolbar">
        <button
          v-for="days in [7, 30]"
          :key="days"
          :class="{ active: isPreset(days) }"
          :aria-pressed="isPreset(days)"
          :disabled="loading"
          @click="usePreset(days)"
        >
          近 {{ days }} 天
        </button>
        <button :aria-expanded="filtersOpen" aria-controls="stats-filters" :disabled="loading" @click="openFilters">
          筛选{{ appliedScope ? ' · 已启用' : '' }}
        </button>
      </div>
    </header>
    <form v-if="filtersOpen" id="stats-filters" class="panel filters" @submit.prevent="loadStats(true)">
      <label>开始日期<input v-model="from" type="date" :max="today" required /></label>
      <label>结束日期<input v-model="to" type="date" :min="from" :max="today" required /></label>
      <label
        >游戏<select v-model="gameId">
          <option value="">全部游戏</option>
          <option v-for="g in games" :key="g.id" :value="String(g.id)">
            {{ g.name }}{{ g.status !== 1 ? '（已停用）' : '' }}
          </option>
        </select></label
      >
      <label
        >分类<select v-model="category">
          <option value="">全部分类</option>
          <option v-for="c in CATEGORIES" :key="c">{{ c }}</option>
        </select></label
      >
      <button type="submit" class="active" :disabled="loading">应用筛选</button>
      <p v-if="gamesError" class="filter-message">游戏选项加载失败，可继续按日期与分类查询。</p>
      <p v-if="filterError" class="filter-message negative" role="alert">{{ filterError }}</p>
    </form>
    <div v-if="loading" class="state" role="status">加载中…</div>
    <div v-else-if="error" class="state" role="alert">
      <p>{{ error }}</p>
      <button @click="loadStats(filtersOpen)">重新加载</button>
    </div>
    <template v-else-if="stats">
      <p class="scope">
        {{ stats.meta.from }} 至 {{ stats.meta.to }}<span v-if="appliedScope"> · {{ appliedScope }}</span>
      </p>
      <p v-if="!stats.meta.has_complete_history" class="notice">
        数据自 {{ stats.meta.data_since }} 起记录，所选时段存在历史缺口，趋势与上期比较可能不完整。
      </p>
      <section class="overview" aria-label="核心指标">
        <article v-for="item in overviewItems" :key="item.key" class="panel metric">
          <h3>{{ item.label }}</h3>
          <strong>{{
            item.percent && !stats.period.uv ? '—' : item.value.toLocaleString() + (item.percent ? '%' : '')
          }}</strong>
          <p v-if="item.percent && !stats.period.uv">暂无阅读，暂不计算</p>
          <p v-else :class="comparisonClass(item.key)">{{ comparisonText(item.key) }}</p>
        </article>
      </section>
      <section class="panel section">
        <div class="section-heading">
          <h3>数据趋势</h3>
          <select v-model="trendMetric" aria-label="趋势指标">
            <option v-for="(label, key) in TREND_METRICS" :key="key" :value="key">{{ label }}</option>
          </select>
        </div>
        <p class="hint">
          {{
            trendMetric === 'uv'
              ? '每日阅读人数分别去重，不可相加作为周期总人数。'
              : trendMetric === 'pv'
                ? '按天展示阅读次数。'
                : '净增 = 新增 − 取消或删除。'
          }}
        </p>
        <div ref="trendRef" class="trend" role="img" :aria-label="`${TREND_METRICS[trendMetric]}每日趋势`"></div>
      </section>
      <section class="panel section">
        <div class="section-heading">
          <h3>
            文章表现 <small>Top {{ showAllPosts ? 10 : 5 }}</small>
          </h3>
          <select v-model="rankBy" aria-label="文章排序指标" @change="loadStats()">
            <option v-for="(label, key) in RANK_METRICS" :key="key" :value="key">按{{ label }}排序</option>
          </select>
        </div>
        <div v-if="visiblePosts.length" class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>文章</th>
                <th>阅读人数</th>
                <th>新增收藏</th>
                <th v-if="extraRankColumn">{{ RANK_METRICS[rankBy] }}</th>
                <th>互动率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="post in visiblePosts" :key="post.id">
                <td>
                  <router-link :to="`/post/${post.id}`">{{ post.title }}</router-link>
                </td>
                <td>{{ post.uv.toLocaleString() }}</td>
                <td>{{ post.favorites_added.toLocaleString() }}</td>
                <td v-if="extraRankColumn">{{ post[rankBy].toLocaleString() }}</td>
                <td>{{ post.uv ? `${post.engagement_rate}%` : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="state">暂无符合筛选条件的已发布文章</p>
        <p class="hint">仅比较所选周期；阅读人数较少时，互动率容易波动，请结合人数判断。</p>
        <button v-if="stats.top_posts.length > 5" class="more" @click="showAllPosts = !showAllPosts">
          {{ showAllPosts ? '收起至 Top 5' : '展开 Top 10' }}
        </button>
      </section>
      <section class="panel secondary">
        <h3>累计概况</h3>
        <p class="hint">以下为当前状态，不受所选日期限制；文章及互动按当前发布状态与内容筛选统计。</p>
        <div class="snapshots">
          <div v-for="[label, value] in snapshotItems" :key="label">
            <span>{{ label }}</span
            ><b>{{ value.toLocaleString() }}</b>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.stats-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 16px 44px;
  color: var(--text-primary);
}
.heading,
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
h2,
h3,
p {
  margin: 0;
}
h2 {
  font-size: 1.25rem;
}
h3 {
  font-size: 0.92rem;
  font-weight: 600;
}
.heading p,
.scope,
.hint,
.metric p {
  color: var(--text-muted);
  font-size: 0.76rem;
  line-height: 1.6;
}
.heading p {
  margin-top: 5px;
}
.toolbar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
button,
select,
input {
  font: inherit;
  font-size: 0.78rem;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  min-height: 36px;
  padding: 7px 11px;
}
button,
select {
  cursor: pointer;
}
button:hover {
  border-color: var(--amber);
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
button.active {
  color: var(--on-amber);
  background: var(--amber);
  border-color: var(--amber);
}
button:focus-visible,
select:focus-visible,
input:focus-visible,
a:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 3px;
}
.scope {
  margin: 18px 0 12px;
}
.panel {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  padding: 16px;
  margin-top: 16px;
}
.filters label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-muted);
}
.filter-message {
  width: 100%;
  font-size: 0.76rem;
}
.overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.metric {
  padding: 18px;
}
.metric h3 {
  color: var(--text-secondary);
  font-size: 0.8rem;
}
.metric strong {
  display: block;
  font-size: 1.8rem;
  margin: 8px 0 4px;
  font-variant-numeric: tabular-nums;
}
.positive {
  color: var(--green, #7cb87c) !important;
}
.negative {
  color: var(--red, #c44b4b) !important;
}
.section {
  padding: 18px;
  margin-bottom: 16px;
}
.hint {
  margin-top: 10px;
}
.trend {
  height: 260px;
  margin-top: 4px;
}
.state {
  text-align: center;
  padding: 36px 12px;
  color: var(--text-muted);
}
.state button {
  margin-top: 12px;
}
.notice {
  padding: 10px 12px;
  margin-bottom: 14px;
  color: var(--amber);
  background: var(--amber-glow);
  border-radius: 7px;
  font-size: 0.76rem;
  line-height: 1.6;
}
small {
  color: var(--text-muted);
  font-size: 0.72rem;
  margin-left: 6px;
  font-weight: 400;
}
.table-scroll {
  overflow-x: auto;
  margin-top: 12px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
th,
td {
  text-align: right;
  padding: 13px 10px;
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
th {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 0.74rem;
}
th:first-child,
td:first-child {
  text-align: left;
  padding-left: 0;
  white-space: normal;
  min-width: 180px;
}
td:first-child {
  width: 48%;
  overflow-wrap: anywhere;
  line-height: 1.6;
}
td a {
  color: var(--text-primary);
  text-decoration: none;
}
td a:hover {
  color: var(--amber);
  text-decoration: underline;
}
.more {
  display: block;
  margin: 14px auto 0;
}
.secondary {
  padding: 15px 18px;
  margin-bottom: 8px;
}
.snapshots {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  margin-top: 16px;
}
.snapshots span {
  color: var(--text-muted);
  font-size: 0.75rem;
}
.snapshots b {
  display: block;
  margin-top: 4px;
  font-size: 1.1rem;
}
@media (max-width: 719px) {
  .heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .metric {
    padding: 14px 12px;
  }
  .metric strong {
    font-size: 1.5rem;
  }
  .section {
    padding: 14px 12px;
  }
  .section-heading {
    gap: 8px;
    flex-wrap: wrap;
  }
  .filters label {
    flex: 1 1 130px;
    min-width: 0;
  }
  .filters input,
  .filters select {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
  }
  .snapshots {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
