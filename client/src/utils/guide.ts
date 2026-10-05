import type { GuideInfo, VideoChapter } from '../types/api'
export const CATEGORIES = ['BOSS攻略', '新手入门', '剧情解析', '装备评测', '全收集', 'Build分享']
export function emptyGuide(): GuideInfo { return { summary: '', game_version: '', prerequisites: '', spoiler: 'none', video_chapters: [] } }
export function guideFrom(value?: GuideInfo | null): GuideInfo { return { ...emptyGuide(), ...value, video_chapters: value?.video_chapters?.map(c => ({ ...c })) || [] } }
export function formatTime(seconds: number): string {
  const total = Math.floor(seconds)
  return total >= 3600 ? `${Math.floor(total / 3600)}:${String(Math.floor(total / 60) % 60).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}` : `${Math.floor(total / 60)}:${String(total % 60).padStart(2,'0')}`
}
export function parseTime(text: string): number | null {
  if (!/^\d{1,3}:\d{2}(:\d{2})?$/.test(text.trim())) return null
  const parts = text.trim().split(':').map(Number)
  if (parts.slice(1).some(n => n > 59)) return null
  const n = parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!
  return n <= 86400 ? n : null
}
export function parseChapters(text: string): VideoChapter[] {
  let previous = -1
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean)
  if (lines.length > 30) throw new Error('视频时间点最多30个')
  return lines.map(line => {
    const match = /^(\S+)\s+(.+)$/.exec(line)
    const seconds = match ? parseTime(match[1]!) : null
    const title = match?.[2]?.trim() || ''
    if (seconds === null || seconds <= previous || !title || Array.from(title).length > 60) throw new Error('时间点请按递增顺序填写，例如 00:15 第二阶段；标题最多60字')
    previous = seconds
    return { seconds, title }
  })
}
export const GUIDE_SECTIONS: Record<string, string[]> = {
  'BOSS攻略': ['打法结论', '准备与装备', '第一阶段', '第二阶段', '常见失误'],
  '新手入门': ['先看结论', '准备工作', '推荐路线', '注意事项'],
  '剧情解析': ['涉及的剧情范围', '关键线索', '分析与推测'],
  '装备评测': ['先看结论', '获取方式', '适用条件', '优缺点'],
  '全收集': ['前置条件', '收集路线', '容易遗漏的内容'],
  'Build分享': ['搭配思路', '属性与装备', '操作要点', '替代选择'],
}
