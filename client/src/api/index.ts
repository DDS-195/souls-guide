import request from '../utils/request'
import type {
  AdminStats,
  Announcement,
  ApiEnvelope,
  Comment,
  CreatorStats,
  FollowUser,
  Game,
  LoginResult,
  MyPost,
  NotificationPage,
  OperationLog,
  PageQuery,
  PageResult,
  Post,
  PostListQuery,
  PostPayload,
  PostStatusResult,
  Report,
  User,
  UserProfile,
} from '../types/api'

// ★契约源：本文件是前后端契约的代码化表现（R8），后端 AI 必须严格对齐；
// 2026-08-16 类型止血：全部函数标注泛型返回，契约字段进入编译器校验。

export const userApi = {
  register: (data: { username: string; password: string }) =>
    request.post<ApiEnvelope<{ id: number }>>('/users/register', data),
  login: (data: { username: string; password: string }) => request.post<ApiEnvelope<LoginResult>>('/users/login', data),
  getMe: () => request.get<ApiEnvelope<User>>('/users/me'),
  getProfile: (id: number) => request.get<ApiEnvelope<UserProfile>>(`/users/${id}`),
  updateProfile: (data: Partial<Pick<User, 'nickname' | 'bio' | 'gender' | 'birthday'>>) =>
    request.put<ApiEnvelope<null>>('/users/me', data),
  applyCreator: (reason?: string) => request.post<ApiEnvelope<null>>('/users/apply-creator', { reason }),
}

export const gameApi = {
  getList: () => request.get<ApiEnvelope<Game[]>>('/games'),
  // 游戏管理（D15：归属 /api/games，auth+admin；后端已实现，2026-08-08 前端补声明对齐契约）
  create: (data: { name: string; description?: string; cover?: string | null; sort_order?: number }) =>
    request.post<ApiEnvelope<{ id: number }>>('/games', data),
  update: (
    id: number,
    data: { name: string; description?: string; cover?: string | null; sort_order?: number; status?: number },
  ) => request.put<ApiEnvelope<null>>(`/games/${id}`, data),
  remove: (id: number) => request.delete<ApiEnvelope<null>>(`/games/${id}`),
  sort: (data: { id: number; sort_order: number }[]) => request.put<ApiEnvelope<null>>('/games/sort', data),
}

export const postApi = {
  // ids: 可选，逗号分隔按 id 批量取 published（2026-08-09 用户批准，历史卡片实时补齐用；公开不 +1 view_count，A2 实现）
  getList: (params?: PostListQuery) => request.get<ApiEnvelope<PageResult<Post>>>('/posts', { params }),
  getDetail: (id: number) => request.get<ApiEnvelope<Post>>(`/posts/${id}`),
  create: (data: PostPayload) => request.post<ApiEnvelope<{ id: number }>>('/posts', data),
  update: (id: number, data: PostPayload) => request.put<ApiEnvelope<null>>(`/posts/${id}`, data),
  remove: (id: number) => request.delete<ApiEnvelope<null>>(`/posts/${id}`),
  like: (id: number) => request.post<ApiEnvelope<{ liked: boolean }>>(`/posts/${id}/like`),
  favorite: (id: number) => request.post<ApiEnvelope<{ favorited: boolean }>>(`/posts/${id}/favorite`),
  getStatus: (id: number) => request.get<ApiEnvelope<PostStatusResult>>(`/posts/${id}/status`),
  submit: (id: number) => request.post<ApiEnvelope<null>>(`/posts/${id}/submit`),
  getMyList: (params?: PageQuery) => request.get<ApiEnvelope<PageResult<MyPost>>>('/posts/my/list', { params }),
  getComments: (postId: number) => request.get<ApiEnvelope<Comment[]>>(`/posts/${postId}/comments`),
  addComment: (postId: number, data: { content: string; parent_id?: number | null }) =>
    request.post<ApiEnvelope<{ id: number }>>(`/posts/${postId}/comments`, data),
}

export const creatorApi = {
  // 创作者数据统计（2026-08-07 新增契约，后端 A2 已于 2026-08-08 实现并验收）
  getStats: () => request.get<ApiEnvelope<CreatorStats>>('/creator/stats'),
}

export const interactApi = {
  getNotifications: (params?: PageQuery) => request.get<ApiEnvelope<NotificationPage>>('/notifications', { params }),
  markAllRead: () => request.put<ApiEnvelope<null>>('/notifications/read-all'),
  // 标记单条已读（契约 4.1 互动模块 PUT /notifications/:id/read，后端已实现，2026-08-09 前端补声明消费）
  markRead: (id: number) => request.put<ApiEnvelope<null>>(`/notifications/${id}/read`),
  getFavorites: (params?: PageQuery) => request.get<ApiEnvelope<PageResult<Post>>>('/favorites', { params }),
  follow: (id: number) => request.post<ApiEnvelope<{ following: boolean }>>(`/follows/${id}`),
  // 提交举报（2026-08-08 用户批准新增契约：POST /api/reports，auth，body {target_type, target_id, reason}；✅ 后端已实现，A1 已实现 UI 并实测）
  report: (data: { target_type: string; target_id: number; reason: string }) =>
    request.post<ApiEnvelope<{ id: number }>>('/reports', data),
  // 关注/粉丝列表（公开分页，2026-08-07 前端 MyLists 页消费登记）
  getFollowing: (id: number, params?: PageQuery) =>
    request.get<ApiEnvelope<PageResult<FollowUser>>>(`/users/${id}/following`, { params }),
  getFollowers: (id: number, params?: PageQuery) =>
    request.get<ApiEnvelope<PageResult<FollowUser>>>(`/users/${id}/followers`, { params }),
}

export const adminApi = {
  getPendingPosts: (params?: PageQuery) =>
    request.get<ApiEnvelope<PageResult<Post>>>('/admin/posts/pending', { params }),
  approvePost: (id: number) => request.put<ApiEnvelope<null>>(`/admin/posts/${id}/approve`),
  rejectPost: (id: number, reason: string) => request.put<ApiEnvelope<null>>(`/admin/posts/${id}/reject`, { reason }),
  getApplications: (params?: PageQuery) =>
    request.get<ApiEnvelope<PageResult<User>>>('/admin/applications', { params }),
  approveApplication: (id: number) => request.put<ApiEnvelope<null>>(`/admin/applications/${id}/approve`),
  rejectApplication: (id: number) => request.put<ApiEnvelope<null>>(`/admin/applications/${id}/reject`),
  getUsers: (params?: PageQuery & { role?: string; keyword?: string }) =>
    request.get<ApiEnvelope<PageResult<User>>>('/admin/users', { params }),
  toggleBan: (id: number) => request.put<ApiEnvelope<null>>(`/admin/users/${id}/ban`),
  deleteUser: (id: number) =>
    request.delete<ApiEnvelope<{ deleted: number; username: string; post_count: number; comment_count: number }>>(
      `/admin/users/${id}`,
    ),
  getAnnouncements: () => request.get<ApiEnvelope<Announcement[]>>('/admin/announcements'),
  createAnnouncement: (data: { title: string; content: string }) =>
    request.post<ApiEnvelope<{ id: number }>>('/admin/announcements', data),
  updateAnnouncement: (id: number, data: { title: string; content: string }) =>
    request.put<ApiEnvelope<null>>(`/admin/announcements/${id}`, data),
  publishAnnouncement: (id: number) => request.put<ApiEnvelope<null>>(`/admin/announcements/${id}/publish`),
  archiveAnnouncement: (id: number) => request.put<ApiEnvelope<null>>(`/admin/announcements/${id}/archive`),
  deleteAnnouncement: (id: number) => request.delete<ApiEnvelope<null>>(`/admin/announcements/${id}`),
  getReports: (params?: PageQuery & { status?: string }) =>
    request.get<ApiEnvelope<PageResult<Report>>>('/admin/reports', { params }),
  // 管理端游戏列表（含停用，auth+admin；2026-08-08 前端补声明对齐契约）
  getAdminGames: () => request.get<ApiEnvelope<Game[]>>('/admin/games'),
  resolveReport: (id: number, data: { status: string; handler_note?: string | null }) =>
    request.put<ApiEnvelope<null>>(`/admin/reports/${id}/resolve`, data),
  getStats: () => request.get<ApiEnvelope<AdminStats>>('/admin/stats'),
  getLatestAnnouncement: () => request.get<ApiEnvelope<Announcement | null>>('/announcements/latest'),
  // 操作日志（D23，2026-08-09 新增契约：GET /api/admin/logs，auth+admin，分页筛选 admin_id/action/keyword/start/end 均可选）
  getLogs: (
    params?: PageQuery & { admin_id?: number; action?: string; keyword?: string; start?: string; end?: string },
  ) => request.get<ApiEnvelope<PageResult<OperationLog>>>('/admin/logs', { params }),
}

// 视频接口单独超时：全局默认 15s 对分片/合并不适用（merge 需覆盖合并+FFmpeg 转码，≤15min）
const VIDEO_STATUS_TIMEOUT = 30 * 1000
const VIDEO_CHUNK_TIMEOUT = 60 * 1000
// 后端转码兜底 15min + 合并耗时余量 → 20min
const VIDEO_MERGE_TIMEOUT = 20 * 60 * 1000

export const mediaApi = {
  uploadImage: (file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    return request.post<ApiEnvelope<{ url: string }>>('/media/upload/image', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  uploadAvatar: (file: File) => {
    const fd = new FormData()
    fd.append('image', file)
    return request.post<ApiEnvelope<{ url: string }>>('/users/me/avatar', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  // 删除已上传媒体（契约 4.1 媒体模块 DELETE /api/media/:id，auth+本人/admin；2026-08-09 补声明对齐契约，前端当前无 UI 消费点）
  remove: (id: number) => request.delete<ApiEnvelope<null>>(`/media/${id}`),
  // 视频分片断点续传三接口（4.1 媒体模块，▲后端先行已实现，见 D12/D13）
  videoStatus: (hash: string) =>
    request.post<ApiEnvelope<{ uploadedChunks: number[]; url: string | null }>>(
      '/media/upload/video/status',
      { hash },
      { timeout: VIDEO_STATUS_TIMEOUT },
    ),
  videoChunk: (hash: string, index: number, totalChunks: number, chunk: Blob, filename?: string) => {
    const fd = new FormData()
    fd.append('hash', hash)
    fd.append('index', String(index))
    fd.append('totalChunks', String(totalChunks))
    // 必须带文件名：否则浏览器默认 filename="blob"，后端扩展名白名单落空 → 400（2026-08-07 修复，契约 4.1）
    fd.append('chunk', chunk, filename)
    return request.post<ApiEnvelope<{ index: number }>>('/media/upload/video/chunk', fd, {
      timeout: VIDEO_CHUNK_TIMEOUT,
    })
  },
  videoMerge: (hash: string, totalChunks: number, originalName?: string) =>
    request.post<ApiEnvelope<{ url: string }>>(
      '/media/upload/video/merge',
      { hash, totalChunks, originalName },
      { timeout: VIDEO_MERGE_TIMEOUT },
    ),
}
