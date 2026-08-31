// D23 自动审计中间件：挂载在已鉴权（auth 通过、req.user 就绪）的路由层，
// 只记录 2xx 成功的管理写操作（POST/PUT/DELETE）；GET 跳过；失败/越权请求不记（排障走错误日志）。
// 规则表按「挂载点内相对路径」匹配（admin.js 内 /posts/3/approve；games.js 内 / 或 /3）；
// desc 优先取规则映射（可引用请求体 body 与响应体 logBody），未命中回退 `METHOD path`。
// 日志记录自身失败绝不干扰主流程（try/catch 吞掉）。
const logService = require('../services/logService')

const s = (v, max) => (v == null ? null : String(v).slice(0, max))

const ADMIN_RULES = [
  { re: /^\/posts\/(\d+)\/approve$/, action: 'approve_post', target: 'post', desc: (m) => `审核通过文章 #${m[1]}` },
  { re: /^\/posts\/(\d+)\/reject$/, action: 'reject_post', target: 'post', desc: (m, b) => `驳回文章 #${m[1]}${b && b.reason ? '：' + s(b.reason, 60) : ''}` },
  { re: /^\/applications\/(\d+)\/approve$/, action: 'approve_application', target: 'user', desc: (m) => `通过创作者申请（用户 #${m[1]}）` },
  { re: /^\/applications\/(\d+)\/reject$/, action: 'reject_application', target: 'user', desc: (m) => `驳回创作者申请（用户 #${m[1]}）` },
  { re: /^\/reports\/(\d+)\/resolve$/, action: 'resolve_report', target: 'report', desc: (m, b) => `处理举报 #${m[1]}（${b && b.status === 'resolved' ? '属实' : b && b.status === 'dismissed' ? '不属实' : b && b.status ? s(b.status, 20) : '未知'}）` },
  { re: /^\/users\/(\d+)\/ban$/, action: 'ban_user', target: 'user', desc: (m, b, logBody) => `封禁/解封用户 #${m[1]}${logBody && logBody.message ? '（' + logBody.message + '）' : ''}` },
  { re: /^\/users\/(\d+)$/, method: 'DELETE', action: 'delete_user', target: 'user', desc: (m, b, logBody) => `删除用户${logBody && logBody.data ? '「' + s(logBody.data.username, 40) + '」' : ' #' + m[1]}${logBody && logBody.data ? `（文章 ${logBody.data.post_count} 篇，评论 ${logBody.data.comment_count} 条）` : ''}` },
  { re: /^\/announcements$/, method: 'POST', action: 'create_announcement', target: 'announcement', desc: (m, b) => `创建公告${b && b.title ? '「' + s(b.title, 40) + '」' : ''}` },
  { re: /^\/announcements\/(\d+)$/, method: 'PUT', action: 'update_announcement', target: 'announcement', desc: (m, b) => `编辑公告 #${m[1]}${b && b.title ? '→「' + s(b.title, 40) + '」' : ''}` },
  { re: /^\/announcements\/(\d+)\/publish$/, action: 'publish_announcement', target: 'announcement', desc: (m) => `发布公告 #${m[1]}` },
  { re: /^\/announcements\/(\d+)\/archive$/, action: 'archive_announcement', target: 'announcement', desc: (m) => `归档公告 #${m[1]}` },
  { re: /^\/announcements\/(\d+)$/, method: 'DELETE', action: 'delete_announcement', target: 'announcement', desc: (m) => `删除公告 #${m[1]}` },
  { re: /^\/notifications$/, action: 'send_notification', target: 'notification', desc: (m, b) => `发送系统通知（${b && b.target_user_id ? '定向用户 #' + b.target_user_id : '全员'}）${b && b.content ? '：「' + s(b.content, 40) + '」' : ''}` },
]

const GAME_RULES = [
  { re: /^\/$/, method: 'POST', action: 'create_game', target: 'game', desc: (m, b) => `创建游戏${b && b.name ? '「' + s(b.name, 40) + '」' : ''}` },
  { re: /^\/sort$/, action: 'sort_games', target: 'game', desc: () => '游戏排序' },
  { re: /^\/(\d+)$/, method: 'PUT', action: 'update_game', target: 'game', desc: (m, b) => `编辑游戏 #${m[1]}${b && b.name ? '→「' + s(b.name, 40) + '」' : ''}` },
  { re: /^\/(\d+)$/, method: 'DELETE', action: 'delete_game', target: 'game', desc: (m) => `删除游戏 #${m[1]}` },
]

// 同一路径的 PUT/DELETE 规则靠 method 区分：无 method 的规则匹配所有方法，
// 故同路径多方法时必须显式声明 method（见 announcements/(\d+) 的 PUT/DELETE 两条）
function matchRule(rules, method, relPath) {
  for (const rule of rules) {
    if (rule.method && rule.method !== method) continue
    const m = rule.re.exec(relPath)
    if (m) return { rule, m }
  }
  return null
}

function createLogMiddleware(rules) {
  return (req, res, next) => {
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return next()
    // 收集响应体（res.json 是最后写出点；adminController 一律走 response.js 的 success → res.json）
    const originalJson = res.json.bind(res)
    res.json = (body) => { res.locals.logBody = body; return originalJson(body) }
    res.on('finish', () => {
      try {
        if (res.statusCode < 200 || res.statusCode >= 300) return
        const user = req.user
        if (!user) return
        const relPath = req.path // 挂载点内相对路径（admin.js：/posts/3/approve；games.js：/ 或 /3）
        const hit = matchRule(rules, req.method, relPath)
        if (!hit) return
        const { rule, m } = hit
        const targetId = m && m[1] ? +m[1] : null
        const detail = rule.desc ? rule.desc(m, req.body, res.locals.logBody || null) : `${req.method} ${relPath}`
        logService.log({
          admin_id: user.id,
          admin_username: s(user.username, 50),
          action: rule.action,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          target_type: rule.target,
          target_id: targetId,
          detail: s(detail, 500),
          ip: s(req.ip, 45),
          status: res.statusCode,
        }).catch(() => {}) // 记录失败不影响响应
      } catch (e) { /* 审计异常不干扰主流程 */ }
    })
    next()
  }
}

module.exports = { createLogMiddleware, ADMIN_RULES, GAME_RULES }
