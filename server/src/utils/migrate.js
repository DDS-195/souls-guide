const pool = require('../config/db')
const securityAssets = require('../../db/migrations/001_security_assets')
const queryIndexes = require('../../db/migrations/002_query_indexes')
const analyticsMetrics = require('../../db/migrations/003_analytics_metrics')
const announcementLifecycle = require('../../db/migrations/004_announcement_lifecycle')

const postReviewVersions = require('../../db/migrations/005_post_review_versions')
const creatorApplications = require('../../db/migrations/006_creator_applications')
const gameVersions = require('../../db/migrations/007_game_versions')
const notificationBatches = require('../../db/migrations/008_notification_batches')
const userManagement = require('../../db/migrations/009_user_management')
const auditContext = require('../../db/migrations/010_audit_context')
const analyticsCapacity = require('../../db/migrations/015_analytics_capacity')
const migrations = [securityAssets, queryIndexes, analyticsMetrics, announcementLifecycle, postReviewVersions, creatorApplications, gameVersions, notificationBatches, userManagement, auditContext, require('../../db/migrations/011_notification_center'), require('../../db/migrations/012_comment_pagination'), require('../../db/migrations/013_post_writing'), require('../../db/migrations/014_guide_experience')]

async function runMigrations() {
  const connection = await pool.getConnection()
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
    const [rows] = await connection.execute('SELECT version FROM schema_migrations')
    const applied = new Set(rows.map((row) => row.version))
    for (const migration of [...migrations, analyticsCapacity, require('../../db/migrations/016_post_revisions')]) {
      if (applied.has(migration.version)) continue
      await migration.up(connection)
      await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [migration.version])
      console.log(`[db] migration applied: ${migration.version}`)
    }
  } finally {
    connection.release()
  }
}

module.exports = runMigrations
