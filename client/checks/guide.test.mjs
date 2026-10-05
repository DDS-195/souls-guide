/* global console */
import assert from 'node:assert/strict'
import { parseTime, formatTime, parseChapters, guideFrom, GUIDE_SECTIONS } from '../src/utils/guide.ts'
assert.equal(parseTime('01:02'),62)
assert.equal(parseTime('1:02:03'),3723)
assert.equal(parseTime('00:60'),null)
assert.equal(parseTime('abc'),null)
assert.equal(parseTime('25:00:00'),null)
assert.equal(formatTime(3723),'1:02:03')
assert.deepEqual(parseChapters('00:00 准备\n00:15 第二阶段'),[{ seconds:0,title:'准备' },{ seconds:15,title:'第二阶段' }])
assert.throws(()=>parseChapters('00:15 A\n00:15 B'))
assert.throws(()=>parseChapters('00:10 A\n00:01 B'))
assert.throws(()=>parseChapters('00:00 '+ '字'.repeat(61)))
assert.deepEqual(parseChapters(''),[])
const a=guideFrom(null),b=guideFrom(a);b.video_chapters.push({ seconds:0,title:'独立' });assert.equal(a.video_chapters.length,0)
assert.ok(Object.values(GUIDE_SECTIONS).every(s=>s.length>=3))
console.log('PASS: guide defaults, template sections, timestamp parsing and ordered chapter validation')
