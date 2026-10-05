// Integration regression: requires the application database; writes only a
// connection-local temporary table, never persistent analytics or user data.
const assert = require('node:assert/strict');
const pool = require('../src/config/db');
const service = require('../src/services/creatorService');
async function main() {
  const db = await pool.getConnection();
  const getConnection = pool.getConnection;
  const release = db.release;
  const [[{ mode }]] = await db.query('SELECT @@SESSION.sql_mode AS mode');
  try {
    await db.query('SET SESSION sql_mode=?', [[...new Set([...mode.split(','), 'ONLY_FULL_GROUP_BY'])].join(',')]);
    const [[schema]] = await db.query('SHOW CREATE TABLE analytics_events');
    await db.query(schema['Create Table'].replace(/^CREATE TABLE /, 'CREATE TEMPORARY TABLE '));
    pool.getConnection = async () => db;
    db.release = () => {};
    const author = -2147483647;
    const options = {from:'2026-09-01',to:'2026-09-03',previousFrom:'2026-08-29',previousTo:'2026-08-31',rankBy:'pv'};
    const empty = await service.getStats(author, options);
    assert.equal(empty.trend.length, 3);
    assert.equal(empty.period.pv, 0);
    for (const [kind, date, visitor, value, internal] of [
      ['view','2026-09-01 00:00:00','a',1,0],
      ['view','2026-09-01 23:59:59','a',2,0],
      ['view','2026-09-02 00:00:00','b',2,0],
      ['like','2026-09-01 12:00:00',null,1,0],
      ['follow','2026-09-01 12:00:00',null,1,0],
      ['unfollow','2026-09-02 12:00:00',null,1,0],
      ['view','2026-09-02 13:00:00','internal',99,1],
      ['view','2026-09-04 00:00:00','outside',99,0],
    ]) await db.execute('INSERT INTO analytics_events(event_type,author_id,actor_id,visitor_key,event_value,is_internal,occurred_at) VALUES(?,?,?,?,?,?,?)',[kind,author,123,visitor,value,internal,date]);
    const result = await service.getStats(author, options);
    assert.equal(result.period.pv, 5);
    assert.equal(result.period.uv, 2);
    assert.deepEqual(result.trend.map(r=>[r.date,r.pv,r.uv,r.likes_added,r.followers_added,r.followers_removed]),[
      ['2026-09-01',3,1,1,1,0],['2026-09-02',2,1,0,0,1],['2026-09-03',0,0,0,0,0],
    ]);
    console.log('PASS strict SQL: empty data, daily grouping, UV deduplication, follower trend, internal exclusion, date boundary');
  } finally {
    pool.getConnection = getConnection;
    db.release = release;
    await db.query('DROP TEMPORARY TABLE IF EXISTS analytics_events');
    await db.query('SET SESSION sql_mode=?',[mode]);
    db.release();
    await pool.end();
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
