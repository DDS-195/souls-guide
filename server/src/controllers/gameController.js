const gameService = require('../services/gameService')
const response = require('../utils/response')

// GET /api/games —— 公开列表（前端 Tab 用，仅启用）
async function getList(req, res) {
  const games = await gameService.findAll()
  response.success(res, games)
}

// POST /api/games —— 新增游戏（auth+admin，D15）
async function createGame(req, res) {
  const { name, description, cover, sort_order } = req.body
  if (!name) return response.error(res, '游戏名不能为空')
  if (name.length > 50) return response.error(res, '游戏名不能超过 50 字')
  if (description && description.length > 500) return response.error(res, '游戏描述不能超过 500 字')
  try {
    const id = await gameService.create({ name, description, cover, sort_order })
    response.success(res, { id }, '创建成功')
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return response.error(res, '游戏名已存在')
    throw err
  }
}

// PUT /api/games/:id —— 编辑游戏（auth+admin）
async function updateGame(req, res) {
  const { name, description, cover, sort_order, status } = req.body
  if (name !== undefined && !name) return response.error(res, '游戏名不能为空')
  if (name && name.length > 50) return response.error(res, '游戏名不能超过 50 字')
  if (description && description.length > 500) return response.error(res, '游戏描述不能超过 500 字')
  try {
    const affected = await gameService.update(req.params.id, { name, description, cover, sort_order, status })
    if (!affected) return response.error(res, '游戏不存在', 404, 404)
    response.success(res, null, '更新成功')
  } catch (err) {
    // 2026-08-13 修复：改名撞唯一约束不再 500
    if (err.code === 'ER_DUP_ENTRY') return response.error(res, '游戏名已存在')
    throw err
  }
}

// DELETE /api/games/:id —— 删除游戏（auth+admin；RESTRICT：有文章不可删）
async function deleteGame(req, res) {
  try {
    const affected = await gameService.remove(req.params.id)
    if (!affected) return response.error(res, '游戏不存在', 404, 404)
    response.success(res, null, '删除成功')
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') return response.error(res, '该游戏下已有文章，不可删除')
    throw err
  }
}

// PUT /api/games/sort —— 批量排序（auth+admin）
async function sortGames(req, res) {
  const items = req.body
  if (!Array.isArray(items) || !items.length) return response.error(res, '参数应为排序数组')
  // 2026-08-13：基本校验，非法项直接 400（旧实现静默吞掉）
  for (const it of items) {
    if (!it || !Number.isInteger(+it.id) || +it.id < 1 || !Number.isInteger(+it.sort_order)) {
      return response.error(res, '排序参数不合法（需为 [{id, sort_order}]）')
    }
  }
  await gameService.sort(items)
  response.success(res, null, '排序已保存')
}

module.exports = { getList, createGame, updateGame, deleteGame, sortGames }
