<script setup lang="ts">
// 创作者数据统计（D20：echarts 2026-08-07 用户批准引入）
// 数据源：GET /api/creator/stats（2026-08-07 新增契约，A2 实现中，见 4.1 创作者统计）
// 页面结构参考常见创作者后台（B站创作中心/公众号数据页）：概览指标卡 + 趋势折线 + Top 排行 + 分类占比
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as echarts from 'echarts'
import { creatorApi } from '../../api'

const loading = ref(true)
const error = ref('')
const overview = ref({
  post_count: 0,
  view_count: 0,
  like_count: 0,
  comment_count: 0,
  favorite_count: 0,
  follower_count: 0,
})
const trend = ref<{ date: string; views: number; likes: number; comments: number }[]>([])
const topPosts = ref<{ id: number; title: string; view_count: number; like_count: number }[]>([])
const categoryDist = ref<{ category: string; count: number }[]>([])

// 图表容器
const trendRef = ref<HTMLDivElement | null>(null)
const barRef = ref<HTMLDivElement | null>(null)
const pieRef = ref<HTMLDivElement | null>(null)
let trendChart: echarts.ECharts | null = null
let barChart: echarts.ECharts | null = null
let pieChart: echarts.ECharts | null = null

// 暗色主题统一配色（与全局 CSS 变量体系一致）
const AXIS = '#64748B'
const SPLIT = 'rgba(255,255,255,0.06)'
const GOLD = '#E8A838'
const CYAN = '#3B9DB5'
const GREEN = '#7CB87C'
const RED = '#C44B4B'

const OVERVIEW_ITEMS = [
  { key: 'post_count', label: '文章总数' },
  { key: 'view_count', label: '总浏览' },
  { key: 'like_count', label: '总点赞' },
  { key: 'comment_count', label: '总评论' },
  { key: 'favorite_count', label: '总收藏' },
  { key: 'follower_count', label: '粉丝' },
] as const

const trendOption = () => ({
  backgroundColor: 'transparent',
  color: [GOLD, CYAN, GREEN],
  tooltip: {
    trigger: 'axis',
    backgroundColor: '#0D1117',
    borderColor: 'rgba(255,255,255,0.1)',
    textStyle: { color: '#E2E8F0', fontSize: 12 },
  },
  legend: { data: ['浏览', '点赞', '评论'], textStyle: { color: AXIS, fontSize: 12 }, top: 0, right: 0 },
  grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
  xAxis: {
    type: 'category',
    data: trend.value.map((t) => t.date.slice(5)),
    axisLine: { lineStyle: { color: SPLIT } },
    axisLabel: { color: AXIS, fontSize: 11 },
    axisTick: { show: false },
  },
  yAxis: {
    type: 'value',
    splitLine: { lineStyle: { color: SPLIT } },
    axisLabel: { color: AXIS, fontSize: 11 },
  },
  series: [
    {
      name: '浏览',
      type: 'line',
      smooth: true,
      symbol: 'none',
      data: trend.value.map((t) => t.views),
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.08 },
    },
    { name: '点赞', type: 'line', smooth: true, symbol: 'none', data: trend.value.map((t) => t.likes) },
    { name: '评论', type: 'line', smooth: true, symbol: 'none', data: trend.value.map((t) => t.comments) },
  ],
})

const barOption = () => {
  const sorted = [...topPosts.value].sort((a, b) => b.view_count - a.view_count).slice(0, 10)
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#0D1117',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#E2E8F0', fontSize: 12 },
    },
    grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: SPLIT } }, axisLabel: { color: AXIS, fontSize: 11 } },
    yAxis: {
      type: 'category',
      data: sorted.map((p) => (p.title.length > 12 ? p.title.slice(0, 12) + '…' : p.title)),
      axisLine: { lineStyle: { color: SPLIT } },
      axisLabel: { color: '#94A3B8', fontSize: 11 },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        data: sorted.map((p) => p.view_count),
        barWidth: 12,
        itemStyle: {
          borderRadius: [0, 6, 6, 0],
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              { offset: 0, color: 'rgba(232,168,56,0.35)' },
              { offset: 1, color: GOLD },
            ],
          },
        },
        label: { show: true, position: 'right', color: AXIS, fontSize: 11 },
      },
    ],
  }
}

const pieOption = () => {
  const total = categoryDist.value.reduce((s, c) => s + c.count, 0)
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} 篇（{d}%）',
      backgroundColor: '#0D1117',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#E2E8F0', fontSize: 12 },
    },
    legend: { bottom: 0, textStyle: { color: AXIS, fontSize: 11 } },
    color: [GOLD, CYAN, GREEN, RED, '#B8861E', '#8B7BC9', '#C9A227', '#5AA8A8'],
    series: [
      {
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '44%'],
        itemStyle: { borderColor: '#0A0E14', borderWidth: 1, borderRadius: 4 },
        label: { color: '#94A3B8', fontSize: 11, formatter: '{b}\n{c} 篇' },
        data: categoryDist.value.map((c) => ({ name: c.category, value: c.count })),
        emptyCircleStyle: { color: 'rgba(255,255,255,0.04)' },
      },
    ],
    graphic: [
      {
        type: 'text',
        left: 'center',
        top: '36%',
        style: { text: String(total), fill: '#E2E8F0', fontSize: 26, fontWeight: 700, textAlign: 'center' },
      },
      {
        type: 'text',
        left: 'center',
        top: '46%',
        style: { text: '文章总数', fill: AXIS, fontSize: 11, textAlign: 'center' },
      },
    ],
  }
}

function renderCharts() {
  nextTick(() => {
    if (trendRef.value) {
      trendChart ||= echarts.init(trendRef.value)
      trendChart.setOption(trendOption(), true)
    }
    if (barRef.value) {
      barChart ||= echarts.init(barRef.value)
      barChart.setOption(barOption(), true)
    }
    if (pieRef.value) {
      pieChart ||= echarts.init(pieRef.value)
      pieChart.setOption(pieOption(), true)
    }
  })
}

function onResize() {
  trendChart?.resize()
  barChart?.resize()
  pieChart?.resize()
}

watch([trend, topPosts, categoryDist], renderCharts)

onMounted(async () => {
  window.addEventListener('resize', onResize)
  try {
    const res: any = await creatorApi.getStats()
    const d = res.data || {}
    overview.value = {
      post_count: 0,
      view_count: 0,
      like_count: 0,
      comment_count: 0,
      favorite_count: 0,
      follower_count: 0,
      ...(d.overview || {}),
    }
    trend.value = d.trend || []
    topPosts.value = d.top_posts || []
    categoryDist.value = d.category_dist || []
  } catch {
    error.value = '统计接口暂不可用，请稍后重试'
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  trendChart?.dispose()
  barChart?.dispose()
  pieChart?.dispose()
})
</script>

<template>
  <div style="max-width: 1000px; margin: 0 auto; padding: 20px 16px 40px; color: var(--text-primary)">
    <h2 style="font-size: 1.2rem; font-weight: 700; margin-bottom: 20px">数据统计</h2>

    <div v-if="loading" style="text-align: center; color: var(--text-muted); padding: 60px">加载中...</div>
    <div v-else-if="error" style="text-align: center; color: var(--text-muted); padding: 60px">
      <div style="font-size: 0.9rem; margin-bottom: 8px">{{ error }}</div>
      <div style="font-size: 0.75rem">请刷新页面重试，若仍失败可联系管理员</div>
    </div>

    <template v-else>
      <!-- 概览指标卡 -->
      <div class="stat-grid">
        <div v-for="item in OVERVIEW_ITEMS" :key="item.key" class="stat-card">
          <div class="stat-value">{{ overview[item.key].toLocaleString() }}</div>
          <div class="stat-label">{{ item.label }}</div>
        </div>
      </div>

      <!-- 图表区 -->
      <div class="chart-grid">
        <div class="chart-card chart-wide">
          <div class="chart-title">近 30 天内容表现</div>
          <div class="chart-note">按发布文章当日的累计指标求和（口径见设计文档 4.1）</div>
          <div v-if="!trend.length" class="chart-empty">暂无数据</div>
          <div v-else ref="trendRef" class="chart-box"></div>
        </div>
        <div class="chart-card">
          <div class="chart-title">分类分布</div>
          <div v-if="!categoryDist.length" class="chart-empty">暂无数据</div>
          <div v-else ref="pieRef" class="chart-box"></div>
        </div>
        <div class="chart-card chart-wide">
          <div class="chart-title">浏览 Top 10 文章</div>
          <div v-if="!topPosts.length" class="chart-empty">暂无数据</div>
          <div v-else ref="barRef" class="chart-box"></div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
@media (min-width: 768px) {
  .stat-grid {
    grid-template-columns: repeat(6, 1fr);
  }
}
.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 16px 12px;
  text-align: center;
}
.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--amber);
}
.stat-label {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-top: 4px;
}

.chart-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
@media (min-width: 900px) {
  .chart-grid {
    grid-template-columns: 1fr 1fr;
  }
  .chart-wide {
    grid-column: 1 / -1;
  }
}
.chart-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 16px;
}
.chart-title {
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 2px;
}
.chart-note {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.chart-box {
  height: 260px;
}
.chart-empty {
  height: 260px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}
</style>
