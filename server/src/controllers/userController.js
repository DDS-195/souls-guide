// 2026-08-13 换用 native bcrypt（用户批准，R2 例外）：bcryptjs 纯 JS 同步实现会阻塞事件循环，
// native bcrypt 走 libuv 线程池，高并发登录不再卡全局（见 SoulsGuide-并发与高可用评估文档.md B1）
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const userService = require('../services/userService')
const response = require('../utils/response')

async function getMe(req, res) {
  const user = await userService.findById(req.user.id)
  if (!user) return response.error(res, '用户不存在', 404, 404)
  response.success(res, user)
}

async function register(req, res) {
  const { username, password } = req.body
  if (!username || !password) {
    return response.error(res, '用户名和密码不能为空')
  }
  // 2026-08-13 修复（P1-1）：超长字段直插 DB 会 ER_DATA_TOO_LONG → 500，改友好 400
  if (username.length > 50) {
    return response.error(res, '用户名不能超过 50 字符')
  }
  if (password.length < 6) {
    return response.error(res, '密码至少6位')
  }
  if (password.length > 72) {
    return response.error(res, '密码不能超过 72 字符')
  }

  const existing = await userService.findByUsername(username)
  if (existing) {
    return response.error(res, '用户名已存在', 409, 409)
  }

  const hashed = await bcrypt.hash(password, 10)
  const id = await userService.create({ username, password: hashed })

  response.success(res, { id }, '注册成功')
}

async function login(req, res) {
  const { username, password } = req.body
  if (!username || !password) {
    return response.error(res, '用户名和密码不能为空')
  }

  const user = await userService.findByUsername(username)
  // 2026-08-13 修复（P2-7）：用户不存在与密码错误统一文案，堵住用户名枚举
  if (!user) {
    return response.error(res, '用户名或密码错误', 401, 401)
  }
  if (user.status === 0) {
    return response.error(res, '账号已被封禁', 403, 403)
  }

  const match = await bcrypt.compare(password, user.password)
  if (!match) {
    return response.error(res, '用户名或密码错误', 401, 401)
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )

  response.success(res, { token, username: user.username, role: user.role }, '登录成功')
}

async function applyCreator(req, res) {
  const user = await userService.findById(req.user.id)
  if (!user) return response.error(res, '用户不存在', 404, 404)
  if (user.role !== 'user') return response.error(res, '你已是创作者或管理员')
  if (user.apply_status === 'pending') return response.error(res, '申请审核中，请耐心等待')
  const reason = (req.body.reason || '').trim()
  if (reason.length > 500) return response.error(res, '申请理由不能超过 500 字')
  await userService.updateApplyStatus(req.user.id, 'pending', reason)
  response.success(res, null, '申请已提交，等待管理员审核')
}

async function uploadAvatar(req, res) {
  if (!req.file) return response.error(res, '请选择图片')
  const result = await userService.uploadAvatar(req.user.id, req.file)
  if (result.duplicate) return response.error(res, '与当前头像重复', 400, 400)
  response.success(res, { url: result.url }, '上传成功')
}

async function updateProfile(req, res) {
  const { nickname, bio, gender, birthday } = req.body
  if (nickname && (nickname.length < 2 || nickname.length > 20)) {
    return response.error(res, '昵称需2~20个字符')
  }
  // 2026-08-13 修复（P1-1）：bio/gender 超长直插 DB 会 500
  if (bio && bio.length > 200) {
    return response.error(res, '个人简介不能超过 200 字')
  }
  if (gender && gender.length > 10) {
    return response.error(res, '性别字段不合法')
  }
  await userService.updateProfile(req.user.id, { nickname, bio, gender, birthday })
  response.success(res, null, '保存成功')
}

// GET /api/users/:id —— 他人主页（文章数/粉丝数/关注数；携带有效 token 时含 is_followed，D19）
async function getProfile(req, res) {
  const id = +req.params.id
  if (!Number.isInteger(id) || id < 1) return response.error(res, '用户不存在', 404, 404)
  const profile = await userService.getProfile(id, req.user ? req.user.id : null)
  if (!profile) return response.error(res, '用户不存在', 404, 404)
  response.success(res, profile)
}

module.exports = { register, login, getMe, applyCreator, uploadAvatar, updateProfile, getProfile }
