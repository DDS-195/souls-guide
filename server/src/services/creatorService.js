const pool = require('../config/db')

const CONTENT_EVENTS = "'view','like','unlike','favorite','unfavorite','comment','comment_delete'"
const RANK_EXPRESSIONS = {
  pv: 'pv',
  uv: 'uv',
  likes_added: 'likes_added',
  favorites_added: 'favorites_added',
  comments_added: 'comments_added',
  engagement_rate: 'engagement_rate',
}

function addDays(date, amount) {
  const [year, month, day] = date.split('-').map(Number)
  const value = new Date(Date.UTC(year, month - 1, day))
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

function dateRange(from, to) {
  const result = []
  for (let date = from; date <= to; date = addDays(date, 1)) result.push(date)
  return result
}

function contentEventWhere({ from, to, gameId, category, postId }) {
  const clauses = [
    'e.author_id=?',
    `e.event_type IN (${CONTENT_EVENTS})`,
    'e.is_internal=0',
    'e.occurred_at>=?',
    'e.occurred_at<DATE_ADD(?, INTERVAL 1 DAY)',
  ]
  const params = [null, `${from} 00:00:00`, `${to} 00:00:00`]
  if (gameId || category || postId) {
    const postClauses = ['p.id=e.post_id', 'p.user_id=e.author_id']
    if (gameId) { postClauses.push('p.game_id=?'); params.push(gameId) }
    if (category) { postClauses.push('p.category=?'); params.push(category) }
    if (postId) { postClauses.push('p.id=?'); params.push(postId) }
    clauses.push(`EXISTS (SELECT 1 FROM posts p WHERE ${postClauses.join(' AND ')})`)
  }
  return { sql: clauses.join(' AND '), params }
}

function summaryRow(row) {
  const result = {
    pv: +row.pv,
    uv: +row.uv,
    likes_added: +row.likes_added,
    likes_removed: +row.likes_removed,
    favorites_added: +row.favorites_added,
    favorites_removed: +row.favorites_removed,
    comments_added: +row.comments_added,
    comments_removed: +row.comments_removed,
    engaged_users: +row.engaged_users,
  }
  result.likes_net = result.likes_added - result.likes_removed
  result.favorites_net = result.favorites_added - result.favorites_removed
  result.comments_net = result.comments_added - result.comments_removed
  result.engagement_rate = result.uv ? Number(((result.engaged_users / result.uv) * 100).toFixed(2)) : 0
  return result
}

async function getContentSummary(db, userId, range, filters) {
  const where = contentEventWhere({ ...range, ...filters })
  where.params[0] = userId
  const [[row]] = await db.execute(
    `WITH scoped_events AS (SELECT e.* FROM analytics_events e WHERE ${where.sql}) SELECT
       COALESCE(SUM(CASE WHEN e.event_type='view' THEN e.event_value ELSE 0 END), 0) AS pv,
       COUNT(DISTINCT CASE WHEN e.event_type='view' THEN e.visitor_key END) AS uv,
       COALESCE(SUM(CASE WHEN e.event_type='like' THEN e.event_value ELSE 0 END), 0) AS likes_added,
       COALESCE(SUM(CASE WHEN e.event_type='unlike' THEN e.event_value ELSE 0 END), 0) AS likes_removed,
       COALESCE(SUM(CASE WHEN e.event_type='favorite' THEN e.event_value ELSE 0 END), 0) AS favorites_added,
       COALESCE(SUM(CASE WHEN e.event_type='unfavorite' THEN e.event_value ELSE 0 END), 0) AS favorites_removed,
       COALESCE(SUM(CASE WHEN e.event_type='comment' THEN e.event_value ELSE 0 END), 0) AS comments_added,
       COALESCE(SUM(CASE WHEN e.event_type='comment_delete' THEN e.event_value ELSE 0 END), 0) AS comments_removed,
       COUNT(DISTINCT CASE WHEN e.event_type IN ('like','favorite','comment') AND EXISTS (
         SELECT 1 FROM scoped_events r WHERE r.event_type='view' AND r.actor_id=e.actor_id
       ) THEN e.actor_id END) AS engaged_users
     FROM scoped_events e`,
    where.params
  )
  return summaryRow(row)
}

async function getFollowerSummary(db, userId, range) {
  const [[row]] = await db.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN event_type='follow' THEN event_value ELSE 0 END), 0) AS followers_added,
       COALESCE(SUM(CASE WHEN event_type='unfollow' THEN event_value ELSE 0 END), 0) AS followers_removed
     FROM analytics_events
     WHERE author_id=? AND event_type IN ('follow','unfollow')
       AND occurred_at>=? AND occurred_at<DATE_ADD(?, INTERVAL 1 DAY)`,
    [userId, `${range.from} 00:00:00`, `${range.to} 00:00:00`]
  )
  return {
    followers_added: +row.followers_added,
    followers_removed: +row.followers_removed,
    followers_net: +row.followers_added - +row.followers_removed,
  }
}

async function getTrend(db, userId, range, filters) {
  if (!filters.gameId && !filters.category && !filters.postId) {
    // A daily UV is already exactly deduplicated at write time. Period UV still
    // uses facts: summing daily UV across days would count returning readers twice.
    const [rows] = await db.execute(`SELECT DATE_FORMAT(metric_date,'%Y-%m-%d') AS date,
      pv,uv,likes_added,likes_removed,favorites_added,favorites_removed,comments_added,comments_removed,
      followers_added,followers_removed FROM analytics_daily_metrics
      WHERE scope_type='creator' AND scope_id=? AND metric_date>=? AND metric_date<=? ORDER BY metric_date`,
      [userId, range.from, range.to])
    const byDate = new Map(rows.map(row => [row.date, row]))
    const columns = ['pv','uv','likes_added','likes_removed','favorites_added','favorites_removed',
      'comments_added','comments_removed','followers_added','followers_removed']
    return dateRange(range.from, range.to).map(date => {
      const row = byDate.get(date) || {}, values = { date }
      for (const column of columns) values[column] = +(row[column] || 0)
      for (const prefix of ['likes','favorites','comments','followers']) values[`${prefix}_net`] = values[`${prefix}_added`] - values[`${prefix}_removed`]
      return values
    })
  }
  const where = contentEventWhere({ ...range, ...filters })
  where.params[0] = userId
  const [contentRows] = await db.execute(
    `SELECT DATE_FORMAT(e.occurred_at, '%Y-%m-%d') AS date,
       SUM(CASE WHEN e.event_type='view' THEN e.event_value ELSE 0 END) AS pv,
       COUNT(DISTINCT CASE WHEN e.event_type='view' THEN e.visitor_key END) AS uv,
       SUM(CASE WHEN e.event_type='like' THEN e.event_value ELSE 0 END) AS likes_added,
       SUM(CASE WHEN e.event_type='unlike' THEN e.event_value ELSE 0 END) AS likes_removed,
       SUM(CASE WHEN e.event_type='favorite' THEN e.event_value ELSE 0 END) AS favorites_added,
       SUM(CASE WHEN e.event_type='unfavorite' THEN e.event_value ELSE 0 END) AS favorites_removed,
       SUM(CASE WHEN e.event_type='comment' THEN e.event_value ELSE 0 END) AS comments_added,
       SUM(CASE WHEN e.event_type='comment_delete' THEN e.event_value ELSE 0 END) AS comments_removed
     FROM analytics_events e WHERE ${where.sql}
     GROUP BY DATE_FORMAT(e.occurred_at, '%Y-%m-%d') ORDER BY date ASC`,
    where.params
  )
  const [followerRows] = await db.execute(
    `SELECT DATE_FORMAT(occurred_at, '%Y-%m-%d') AS date,
       SUM(event_type='follow') AS followers_added,
       SUM(event_type='unfollow') AS followers_removed
     FROM analytics_events
     WHERE author_id=? AND event_type IN ('follow','unfollow')
       AND occurred_at>=? AND occurred_at<DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY DATE_FORMAT(occurred_at, '%Y-%m-%d') ORDER BY date ASC`,
    [userId, `${range.from} 00:00:00`, `${range.to} 00:00:00`]
  )
  const content = new Map(contentRows.map((row) => [row.date, row]))
  const followers = new Map(followerRows.map((row) => [row.date, row]))
  return dateRange(range.from, range.to).map((date) => {
    const row = content.get(date) || {}
    const follower = followers.get(date) || {}
    const values = {
      date,
      pv: +(row.pv || 0),
      uv: +(row.uv || 0),
      likes_added: +(row.likes_added || 0),
      likes_removed: +(row.likes_removed || 0),
      favorites_added: +(row.favorites_added || 0),
      favorites_removed: +(row.favorites_removed || 0),
      comments_added: +(row.comments_added || 0),
      comments_removed: +(row.comments_removed || 0),
      followers_added: +(follower.followers_added || 0),
      followers_removed: +(follower.followers_removed || 0),
    }
    return {
      ...values,
      likes_net: values.likes_added - values.likes_removed,
      favorites_net: values.favorites_added - values.favorites_removed,
      comments_net: values.comments_added - values.comments_removed,
      followers_net: values.followers_added - values.followers_removed,
    }
  })
}

function postFilterSql(filters, alias = 'p') {
  const clauses = [`${alias}.user_id=?`, `${alias}.status='published'`]
  const params = []
  if (filters.gameId) { clauses.push(`${alias}.game_id=?`); params.push(filters.gameId) }
  if (filters.category) { clauses.push(`${alias}.category=?`); params.push(filters.category) }
  if (filters.postId) { clauses.push(`${alias}.id=?`); params.push(filters.postId) }
  return { sql: clauses.join(' AND '), params }
}

async function getCurrentTotals(db, userId, filters) {
  const filter = postFilterSql(filters)
  const baseParams = [userId, ...filter.params]
  const [[posts]] = await db.execute(
    `SELECT COUNT(*) AS published_posts, COALESCE(SUM(view_count), 0) AS legacy_lifetime_views
     FROM posts p WHERE ${filter.sql}`,
    baseParams
  )
  const [[likes]] = await db.execute(
    `SELECT COUNT(*) AS active_likes FROM likes x JOIN posts p ON p.id=x.post_id
     WHERE ${filter.sql} AND x.user_id<>p.user_id`,
    baseParams
  )
  const [[favorites]] = await db.execute(
    `SELECT COUNT(*) AS active_favorites FROM favorites x JOIN posts p ON p.id=x.post_id
     WHERE ${filter.sql} AND x.user_id<>p.user_id`,
    baseParams
  )
  const [[comments]] = await db.execute(
    `SELECT COUNT(*) AS active_comments FROM comments x JOIN posts p ON p.id=x.post_id
     WHERE ${filter.sql} AND x.user_id<>p.user_id`,
    baseParams
  )
  const [[followers]] = await db.execute('SELECT COUNT(*) AS followers FROM follows WHERE following_id=?', [userId])
  return {
    published_posts: +posts.published_posts,
    legacy_lifetime_views: +posts.legacy_lifetime_views,
    active_likes: +likes.active_likes,
    active_favorites: +favorites.active_favorites,
    active_comments: +comments.active_comments,
    followers: +followers.followers,
  }
}

async function getTopPosts(db, userId, range, filters, rankBy) {
  const filter = postFilterSql(filters)
  const rank = RANK_EXPRESSIONS[rankBy] || RANK_EXPRESSIONS.pv
  const [rows] = await db.execute(
    `WITH readers AS (SELECT DISTINCT post_id,actor_id FROM analytics_events
       WHERE author_id=? AND event_type='view' AND is_internal=0 AND actor_id IS NOT NULL
       AND occurred_at>=? AND occurred_at<DATE_ADD(?, INTERVAL 1 DAY))
     SELECT p.id, p.title, DATE_FORMAT(p.published_at, '%Y-%m-%d') AS published_at,
       COALESCE(SUM(CASE WHEN e.event_type='view' THEN e.event_value ELSE 0 END), 0) AS pv,
       COUNT(DISTINCT CASE WHEN e.event_type='view' THEN e.visitor_key END) AS uv,
       COALESCE(SUM(CASE WHEN e.event_type='like' THEN e.event_value ELSE 0 END), 0) AS likes_added,
       COALESCE(SUM(CASE WHEN e.event_type='favorite' THEN e.event_value ELSE 0 END), 0) AS favorites_added,
       COALESCE(SUM(CASE WHEN e.event_type='comment' THEN e.event_value ELSE 0 END), 0) AS comments_added,
       COUNT(DISTINCT CASE WHEN e.event_type IN ('like','favorite','comment') AND EXISTS (
         SELECT 1 FROM readers r WHERE r.post_id=p.id AND r.actor_id=e.actor_id
       ) THEN e.actor_id END) AS engaged_users,
       CASE WHEN COUNT(DISTINCT CASE WHEN e.event_type='view' THEN e.visitor_key END)=0 THEN 0
            ELSE ROUND(COUNT(DISTINCT CASE WHEN e.event_type IN ('like','favorite','comment') AND EXISTS (
                 SELECT 1 FROM readers r WHERE r.post_id=p.id AND r.actor_id=e.actor_id
               ) THEN e.actor_id END)
                 / COUNT(DISTINCT CASE WHEN e.event_type='view' THEN e.visitor_key END) * 100, 2)
       END AS engagement_rate
     FROM posts p
     LEFT JOIN analytics_events e ON e.post_id=p.id AND e.author_id=p.user_id AND e.is_internal=0
       AND e.occurred_at>=? AND e.occurred_at<DATE_ADD(?, INTERVAL 1 DAY)
     WHERE ${filter.sql}
     GROUP BY p.id, p.title, p.published_at
     ORDER BY ${rank} DESC, p.id DESC LIMIT 10`,
    [userId, `${range.from} 00:00:00`, `${range.to} 00:00:00`, `${range.from} 00:00:00`, `${range.to} 00:00:00`, userId, ...filter.params]
  )
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    published_at: row.published_at,
    pv: +row.pv,
    uv: +row.uv,
    likes_added: +row.likes_added,
    favorites_added: +row.favorites_added,
    comments_added: +row.comments_added,
    engaged_users: +row.engaged_users,
    engagement_rate: +row.engagement_rate,
  }))
}

async function getCategoryPerformance(db, userId, range, filters) {
  const filter = postFilterSql(filters)
  const [rows] = await db.execute(
    `WITH readers AS (SELECT DISTINCT p.category,r.actor_id FROM analytics_events r JOIN posts p ON p.id=r.post_id
       WHERE r.author_id=? AND r.event_type='view' AND r.is_internal=0 AND r.actor_id IS NOT NULL
       AND r.occurred_at>=? AND r.occurred_at<DATE_ADD(?, INTERVAL 1 DAY)
       AND ${filter.sql}) SELECT p.category, COUNT(DISTINCT p.id) AS post_count,
       COALESCE(SUM(CASE WHEN e.event_type='view' THEN e.event_value ELSE 0 END), 0) AS pv,
       COUNT(DISTINCT CASE WHEN e.event_type='view' THEN e.visitor_key END) AS uv,
       COALESCE(SUM(CASE WHEN e.event_type='like' THEN e.event_value ELSE 0 END), 0) AS likes_added,
       COALESCE(SUM(CASE WHEN e.event_type='favorite' THEN e.event_value ELSE 0 END), 0) AS favorites_added,
       COALESCE(SUM(CASE WHEN e.event_type='comment' THEN e.event_value ELSE 0 END), 0) AS comments_added,
       COUNT(DISTINCT CASE WHEN e.event_type IN ('like','favorite','comment') AND EXISTS (
         SELECT 1 FROM readers r WHERE r.category=p.category AND r.actor_id=e.actor_id
       ) THEN e.actor_id END) AS engaged_users
     FROM posts p
     LEFT JOIN analytics_events e ON e.post_id=p.id AND e.author_id=p.user_id AND e.is_internal=0
       AND e.occurred_at>=? AND e.occurred_at<DATE_ADD(?, INTERVAL 1 DAY)
     WHERE ${filter.sql}
     GROUP BY p.category ORDER BY post_count DESC, p.category ASC`,
    [userId, `${range.from} 00:00:00`, `${range.to} 00:00:00`, userId, ...filter.params, `${range.from} 00:00:00`, `${range.to} 00:00:00`, userId, ...filter.params]
  )
  return rows.map((row) => ({
    category: row.category,
    post_count: +row.post_count,
    pv: +row.pv,
    uv: +row.uv,
    average_uv: row.post_count ? Number((+row.uv / +row.post_count).toFixed(2)) : 0,
    likes_added: +row.likes_added,
    favorites_added: +row.favorites_added,
    comments_added: +row.comments_added,
    engagement_rate: +row.uv ? Number(((+row.engaged_users / +row.uv) * 100).toFixed(2)) : 0,
  }))
}

function comparison(current, previous) {
  const compare = (key) => ({
    current: current[key],
    previous: previous[key],
    change_percent: previous[key] === 0
      ? (current[key] === 0 ? 0 : null)
      : Number((((current[key] - previous[key]) / previous[key]) * 100).toFixed(2)),
  })
  return {
    pv: compare('pv'),
    uv: compare('uv'),
    likes_net: compare('likes_net'),
    favorites_net: compare('favorites_net'),
    comments_net: compare('comments_net'),
    followers_net: compare('followers_net'),
    engagement_rate: {
      current: current.engagement_rate,
      previous: previous.engagement_rate,
      change_percent: Number((current.engagement_rate - previous.engagement_rate).toFixed(2)),
    },
  }
}

async function getStats(userId, options) {
  const db = await pool.getConnection()
  try {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await db.beginTransaction()
    const range = { from: options.from, to: options.to }
    const previousRange = { from: options.previousFrom, to: options.previousTo }
    const filters = { gameId: options.gameId, category: options.category, postId: options.postId }

    const currentTotals = await getCurrentTotals(db, userId, filters)
    const currentContent = await getContentSummary(db, userId, range, filters)
    const currentFollowers = await getFollowerSummary(db, userId, range)
    const previousContent = await getContentSummary(db, userId, previousRange, filters)
    const previousFollowers = await getFollowerSummary(db, userId, previousRange)
    const period = { ...currentContent, ...currentFollowers }
    const previous = { ...previousContent, ...previousFollowers }
    const trend = await getTrend(db, userId, range, filters)
    const topPosts = await getTopPosts(db, userId, range, filters, options.rankBy)
    const categoryPerformance = await getCategoryPerformance(db, userId, range, filters)
    const [[metaRow]] = await db.execute(
      `SELECT
         DATE_FORMAT(COALESCE((SELECT applied_at FROM schema_migrations WHERE version='003_analytics_metrics'), NOW()), '%Y-%m-%d') AS data_since,
         DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS generated_at`
    )
    await db.commit()

    return {
      meta: {
        from: range.from,
        to: range.to,
        timezone: 'Asia/Shanghai',
        generated_at: metaRow.generated_at,
        data_since: metaRow.data_since,
        has_complete_history: range.from >= metaRow.data_since,
        definitions_version: '2.1',
        filters: {
          game_id: options.gameId || null,
          category: options.category || null,
          post_id: options.postId || null,
          rank_by: options.rankBy,
        },
      },
      current: currentTotals,
      period,
      comparison: comparison(period, previous),
      trend,
      top_posts: topPosts,
      category_performance: categoryPerformance,
    }
  } catch (error) {
    await db.rollback().catch(() => {})
    throw error
  } finally {
    db.release()
  }
}

module.exports = { getStats, addDays }
