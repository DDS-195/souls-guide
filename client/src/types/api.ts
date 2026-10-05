/**
 * SoulsGuide 业务类型定义（2026-08-16 工程化改造 · 类型止血）
 * 权威来源：SoulsGuide-设计文档.md 第 3 章（表结构）与第 4 章（API 契约）
 * 目的：替换全项目 `any`，让契约进入编译器——后端改字段时前端在 vue-tsc 阶段立即报错
 * 命名约定：字段名与后端响应严格一致（snake_case），不转换；枚举值取自 schema.sql 的 ENUM 定义
 */

// ================= 通用 =================

/** 统一响应信封（设计文档 4.0，request.ts 拦截器返回的完整对象） */
export interface ApiEnvelope<T = unknown> {
  code: number
  message: string
  data: T
}

/** 分页响应（4.0 分页列表格式） */
export interface PageResult<T> {
  total: number
  page: number
  pageSize: number
  list: T[]
}

/** 分页查询参数 */
export interface PageQuery {
  page?: number
  pageSize?: number
}

// ================= 用户（3.1 users） =================

export type UserRole = 'user' | 'creator' | 'admin'
export type ApplyStatus = 'none' | 'pending' | 'approved' | 'rejected'

export interface CreatorApplication {
  id: number
  user_id: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  submitted_at: string | null
  reviewed_at: string | null
  reviewer_username: string | null
  reject_reason: string | null
  legacy: number
  username: string
  nickname: string | null
  avatar: string | null
  user_status: number
}

/** 用户完整信息（GET /users/me） */
export interface User {
  management_version?: number
  id: number
  username: string
  nickname: string | null
  avatar: string | null
  bio: string | null
  gender: string | null
  birthday: string | null
  role: UserRole
  apply_status: ApplyStatus
  apply_reason?: string | null
  application?: Pick<
    CreatorApplication,
    'id' | 'reason' | 'status' | 'submitted_at' | 'reviewed_at' | 'reject_reason' | 'legacy'
  > | null
  status: number
  created_at?: string
  updated_at?: string
}

/** 他人主页响应（GET /users/:id，4.1 用户模块，D19 起含 is_followed） */
export interface UserProfile extends User {
  post_count: number
  follower_count: number
  following_count: number
  is_followed?: boolean
}

/** 登录响应（POST /users/login） */
export interface LoginResult {
  token: string
  username: string
  role: UserRole
}

/** 关注/粉丝列表项（GET /users/:id/following|followers） */
export interface FollowUser {
  id: number
  username: string
  nickname: string | null
  avatar: string | null
  followed_at?: string
}

// ================= 游戏（3.2 games） =================

export interface Game {
  version: number
  post_count?: number
  id: number
  name: string
  cover: string | null
  description: string | null
  sort_order: number
  status: number
  created_at?: string
  updated_at?: string
}

// ================= 文章（3.3 posts） =================

export type PostStatus = 'draft' | 'pending' | 'published' | 'rejected'

/** 媒体资源（3.8 media，仅详情/我的列表返回） */
export interface MediaItem {
  id: number
  url: string
  type: 'image' | 'video'
  sort_order: number
}
export interface VideoChapter { seconds: number; title: string }
export interface GuideInfo {
  summary: string
  game_version: string
  prerequisites: string
  spoiler: 'none' | 'minor' | 'major'
  video_chapters: VideoChapter[]
}

/** 文章（列表/详情，列表无 content/media） */
export interface Post {
  /** Private management/review endpoints only: revision and canonical visibility. */
  is_revision?: boolean
  public_status?: PostStatus
  /** Public list summary: whether an associated video exists; no video URL or preload. */
  has_video?: boolean
  guide_info?: GuideInfo | null
  content_version?: number
  submitted_at?: string | null
  id: number
  title: string
  content?: string
  cover: string | null
  game_id: number
  game_name?: string
  category: string
  status: PostStatus
  reject_reason?: string | null
  view_count: number
  like_count: number
  /** 详情接口返回；列表接口可省略。 */
  favorite_count?: number
  comment_count: number
  user_id: number
  username?: string
  nickname?: string | null
  avatar?: string | null
  tags?: string[]
  media?: MediaItem[]
  created_at?: string
  updated_at?: string
  published_at?: string | null
}

/** 我的文章列表项（GET /posts/my/list，方案 A 起每项含 content/tags/media（video）——编辑回填数据源） */
export interface MyPost extends Post {
  content_version: number
  content: string
  tags: string[]
  media: MediaItem[]
}

export interface ReviewPost extends MyPost {
  content_version: number
  reviews: Array<{
    id: number
    content_version: number
    reviewer_username: string
    decision: 'published' | 'rejected'
    reason: string | null
    created_at: string
  }>
}

/** 文章互动状态（GET /posts/:id/status，D17） */
export interface PostStatusResult {
  liked: boolean
  favorited: boolean
  is_followed: boolean
}

/** 文章创建/编辑 body（4.1 文章模块，status 不接受请求体，传了也无副作用） */
export interface PostPayload {
  guide_info?: GuideInfo | null
  title: string
  content: string
  game_id: number
  category: string
  status?: 'draft' | 'pending'
  tags: string[]
  video: string | null
  cover: string | null
}

/** 文章列表查询参数（GET /posts，4.1：game_id/category/tag_id/keyword/user_id/ids/sort + 分页） */
export interface PostListQuery extends PageQuery {
  game_id?: number | string
  category?: string
  tag_id?: number | string
  keyword?: string
  user_id?: number
  ids?: string
  sort?: 'latest' | 'hot'
}

// ================= 评论（3.9 comments，嵌套树） =================

export interface Comment {
  reply_count?: number
  focus_path?: boolean
  is_deleted?: number
  id: number
  content: string
  user_id: number | null
  post_id: number
  parent_id: number | null
  created_at?: string
  username?: string
  nickname?: string | null
  avatar?: string | null
  replies: Comment[]
}

// ================= 通知（3.6 notifications） =================

export type NotificationType = 'like' | 'comment' | 'reply' | 'follow' | 'audit' | 'system'

export interface Notification {
  context_title?: string | null
  comment_id?: number | null
  target_available?: number
  id: number
  receiver_id: number
  sender_id: number | null
  type: NotificationType
  target_type: string | null
  target_id: number | null
  content: string
  is_read: number
  created_at?: string
  username?: string | null
  nickname?: string | null
  avatar?: string | null
}

/** 通知分页响应（4.1：分页字段之外额外含 unread 未读数） */
export interface NotificationPage extends PageResult<Notification> {
  unread: number
  cutoff_id: number
}

// ================= 举报（3.7 reports） =================

export type ReportTargetType = 'post' | 'user' | 'comment'
export type ReportStatus = 'pending' | 'resolved' | 'dismissed'

export interface Report {
  id: number
  reporter_id: number
  target_type: ReportTargetType
  target_id: number
  reason: string
  status: ReportStatus
  handler_id: number | null
  handler_note: string | null
  created_at?: string
  updated_at?: string
}

// ================= 公告（3.13 announcements） =================

export type AnnouncementStatus = 'draft' | 'published' | 'archived' | 'deleted'

export interface Announcement {
  id: number
  title: string
  content: string
  author_id: number
  status: AnnouncementStatus
  version: number
  source_id: number | null
  author_username?: string
  is_read?: 0 | 1
  published_at?: string | null
  archived_at?: string | null
  created_at?: string
  updated_at?: string
}

// ================= 操作日志（3.14 operation_logs） =================

export interface OperationLog {
  request_id?: string | null
  event_key?: string | null
  metadata?: Record<string, unknown> | null
  id: number
  admin_id: number
  admin_username: string
  action: string
  method: string
  path: string
  target_type: string | null
  target_id: number | null
  detail: string | null
  ip: string | null
  status: number
  created_at?: string
}

// ================= 统计 =================

export type CreatorRankMetric = 'pv' | 'uv' | 'likes_added' | 'favorites_added' | 'comments_added' | 'engagement_rate'

export type CreatorTrendMetric = 'pv' | 'uv' | 'likes_net' | 'favorites_net' | 'comments_net' | 'followers_net'

export interface CreatorStatsQuery {
  from?: string
  to?: string
  game_id?: number
  category?: string
  post_id?: number
  rank_by?: CreatorRankMetric
}

export interface MetricComparison {
  current: number
  previous: number
  /** null 表示上一周期为 0，无法计算百分比。互动率字段表示百分点差。 */
  change_percent: number | null
}

export interface CreatorStatsPeriod {
  pv: number
  uv: number
  likes_added: number
  likes_removed: number
  likes_net: number
  favorites_added: number
  favorites_removed: number
  favorites_net: number
  comments_added: number
  comments_removed: number
  comments_net: number
  followers_added: number
  followers_removed: number
  followers_net: number
  engaged_users: number
  engagement_rate: number
}

export interface CreatorStatsTrend {
  date: string
  pv: number
  uv: number
  likes_added: number
  likes_removed: number
  likes_net: number
  favorites_added: number
  favorites_removed: number
  favorites_net: number
  comments_added: number
  comments_removed: number
  comments_net: number
  followers_added: number
  followers_removed: number
  followers_net: number
}

/** 创作者统计 v2：当前快照与周期事件严格分离。 */
export interface CreatorStats {
  meta: {
    from: string
    to: string
    timezone: 'Asia/Shanghai'
    generated_at: string
    data_since: string
    has_complete_history: boolean
    definitions_version: '2.1'
    filters: { game_id: number | null; category: string | null; post_id: number | null; rank_by: CreatorRankMetric }
  }
  current: {
    published_posts: number
    legacy_lifetime_views: number
    active_likes: number
    active_favorites: number
    active_comments: number
    followers: number
  }
  period: CreatorStatsPeriod
  comparison: Record<CreatorTrendMetric | 'engagement_rate', MetricComparison>
  trend: CreatorStatsTrend[]
  top_posts: Array<{
    id: number
    title: string
    published_at: string | null
    pv: number
    uv: number
    likes_added: number
    favorites_added: number
    comments_added: number
    engaged_users: number
    engagement_rate: number
  }>
  category_performance: Array<{
    category: string
    post_count: number
    pv: number
    uv: number
    average_uv: number
    likes_added: number
    favorites_added: number
    comments_added: number
    engagement_rate: number
  }>
}

/** 全站统计（GET /admin/stats） */
export interface AdminStats {
  totalUsers: number
  totalPosts: number
  totalViews: number
}

// ================= 前端本地数据结构 =================

/** 浏览历史本地快照（PostDetail 写入 localStorage viewHistory，2026-08-09 卡片化方案） */
export interface HistorySnapshot {
  id: number
  title: string
  time: string
  cover: string | null
  game_id: number
  game_name?: string
  category: string
  tags: string[]
  view_count: number
  like_count: number
  comment_count: number
  username: string
  user_id: number
  avatar: string | null
}
