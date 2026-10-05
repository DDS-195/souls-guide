/* global console */
import assert from 'node:assert/strict'
import { playResultTransition } from '../src/utils/resultMotion.ts'
import { animateComment } from '../src/utils/motion.ts'
import { articleReturnLocation, captureArticleOrigin, playArticleArrival, prepareArticleReturn } from '../src/utils/articleMotion.ts'

let reducedMotion = false
globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) }

const calls = []
const makeTarget = id => ({
  isConnected: true,
  getAnimations: () => [],
  animate: (frames, options) => calls.push({ id, frames, options }),
})
const cards = Array.from({ length: 9 }, (_, index) => makeTarget(index))
const root = { ...makeTarget('root'), querySelectorAll: () => cards }

playResultTransition(root)
assert.equal(calls.length, 6, 'animate only the first six cards')
assert.deepEqual(calls.map(call => call.options.delay), [0, 36, 72, 108, 144, 180])
assert.ok(calls.every(call => call.options.fill === 'backwards'))

calls.length = 0
reducedMotion = true
playResultTransition(root)
assert.equal(calls.length, 0, 'respect reduced-motion preference')

reducedMotion = false
playResultTransition({ ...root, isConnected: false })
assert.equal(calls.length, 0, 'do not animate detached results')

playResultTransition({ ...root, querySelectorAll: () => [] })
assert.equal(calls.length, 1, 'animate an empty-result state once')

let completed = 0
reducedMotion = true
calls.length = 0
animateComment(makeTarget('comment'), () => completed++, true)
assert.equal(completed, 1, 'reduced motion still completes the removal lifecycle')
assert.equal(calls.length, 0)

reducedMotion = false
globalThis.getComputedStyle = () => ({ paddingTop: '12px', paddingBottom: '12px', marginTop: '0px' })
let cancel
const comment = { ...makeTarget('comment'), style: { overflow: 'visible' }, getBoundingClientRect: () => ({height:80}), animate: () => ({finished:new Promise((_resolve,reject)=>{cancel=reject})}) }
animateComment(comment, () => completed++, true, true)
assert.equal(completed, 1, 'do not remove the comment before the animation settles')
cancel(Error('navigation interrupted animation'))
await Promise.resolve()
assert.equal(completed, 2, 'interruption must finish removal without leaving a stuck node')
assert.equal(comment.style.overflow, 'visible')

const titleRect = { left: 20, top: 100, width: 200, height: 24, bottom: 124 }
const title = { isConnected: true, textContent: '攻略标题', style: { opacity: '.9' }, getBoundingClientRect: () => titleRect }
const click = { button: 0, currentTarget: title }
reducedMotion = true
captureArticleOrigin(click, 19, '/?game=1&sort=views')
assert.equal(articleReturnLocation('19'), '/?game=1&sort=views', 'reduced motion must preserve the source location')
captureArticleOrigin({ ...click, ctrlKey: true }, 20, '/')
assert.equal(articleReturnLocation('19'), '/?game=1&sort=views', 'new-tab clicks must not overwrite the current-tab origin')
assert.equal(articleReturnLocation('20'), null)

let cloned = 0
let titleCancel
globalThis.window.innerHeight = 800
globalThis.getComputedStyle = () => ({ font: '700 20px serif', lineHeight: '24px', color: '#fff', letterSpacing: '0px' })
globalThis.document = {
  body: { appendChild: () => cloned++ },
  createElement: () => ({ style: {}, setAttribute() {}, remove() { cloned-- }, animate: () => ({ finished: new Promise((_resolve, reject) => { titleCancel = reject }), cancel() { titleCancel?.(Error('cancelled')) } }) }),
  querySelector: () => title,
}
reducedMotion = false
const targetTitle = { ...title, animate() {} }
playArticleArrival(19, targetTitle)
assert.equal(cloned, 1)
assert.equal(targetTitle.style.opacity, '0')
prepareArticleReturn('/post/19', '/me/profile', '/me/profile')
await Promise.resolve()
assert.equal(cloned, 0, 'route interruption must remove the title clone')
assert.equal(targetTitle.style.opacity, '.9', 'route interruption must restore the target title')

console.log('PASS: bounded result motion, reduced-motion navigation and interrupted comment/title cleanup')
