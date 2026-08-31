const pool = require('../config/db')

// 创作者数据统计（设计文档 4.1「创作者统计」契约，2026-08-08 实现）：
// overview 仅统计 published 文章（post_count = published 数）；follower_count 实时 COUNT follows；
// trend 为近 30 天按日聚合「当日发布文章的当前指标求和」（view_count 是累计值，无法追溯增量，
//   文档定案口径），无数据日期补 0，倒序；
// top_posts 为 published 浏览量 Top10；category_dist 按分类计数。
async function getStats(userId) {
  // overview：published 累计指标（SUM 经 mysql2 返回字符串，统一 Number 化）
  const [[overviewRow]] = await pool.execute(
    `SELECT COUNT(*) AS post_count,
            COALESCE(SUM(view_count), 0) AS view_count,
            COALESCE(SUM(like_count), 0) AS like_count,
            COALESCE(SUM(comment_count), 0) AS comment_count
     FROM posts WHERE user_id = ? AND status = 'published'`,
    [userId]
  )
  const [[{ favorite_count }]] = await pool.execute(
    'SELECT COUNT(*) AS favorite_count FROM favorites f JOIN posts p ON f.post_id = p.id WHERE p.user_id = ? AND p.status = ?',
    [userId, 'published']
  )
  const [[{ follower_count }]] = await pool.execute(
    'SELECT COUNT(*) AS follower_count FROM follows WHERE following_id = ?',
    [userId]
  )

  // trend：递归 CTE 生成近 30 天（含今天）日期序列，LEFT JOIN 当日发布文章的聚合，倒序；
  // 日期全部在 SQL 内以 DATE_FORMAT 输出字符串，避免 JS 时区换算差异
  const [trendRows] = await pool.execute(
    `WITH RECURSIVE days AS (
       SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS d, 0 AS n
       UNION ALL
       SELECT DATE_FORMAT(d - INTERVAL 1 DAY, '%Y-%m-%d'), n + 1 FROM days WHERE n < 29
     )
     SELECT days.d AS date,
            COALESCE(t.views, 0) AS views,
            COALESCE(t.likes, 0) AS likes,
            COALESCE(t.comments, 0) AS comments
     FROM days
     LEFT JOIN (
       SELECT DATE(created_at) AS d,
              SUM(view_count) AS views,
              SUM(like_count) AS likes,
              SUM(comment_count) AS comments
       FROM posts
       WHERE user_id = ? AND status = 'published'
       GROUP BY DATE(created_at)
     ) t ON t.d = days.d
     ORDER BY days.d DESC`,
    [userId]
  )
  const trend = trendRows.map(r => ({
    date: r.date,
    views: +r.views,
    likes: +r.likes,
    comments: +r.comments,
  }))

  // top_posts：published 浏览量 Top10（id DESC 兜底稳定排序）
  const [topPosts] = await pool.execute(
    'SELECT id, title, view_count, like_count FROM posts WHERE user_id = ? AND status = ? ORDER BY view_count DESC, id DESC LIMIT 10',
    [userId, 'published']
  )

  // category_dist：published 按分类计数
  const [categoryDist] = await pool.execute(
    'SELECT category, COUNT(*) AS count FROM posts WHERE user_id = ? AND status = ? GROUP BY category',
    [userId, 'published']
  )

  return {
    overview: {
      post_count: +overviewRow.post_count,
      view_count: +overviewRow.view_count,
      like_count: +overviewRow.like_count,
      comment_count: +overviewRow.comment_count,
      favorite_count: +favorite_count,
      follower_count: +follower_count,
    },
    trend,
    top_posts: topPosts.map(p => ({ id: p.id, title: p.title, view_count: +p.view_count, like_count: +p.like_count })),
    category_dist: categoryDist.map(c => ({ category: c.category, count: +c.count })),
  }
}

module.exports = { getStats }
