/* global URL, console */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { setImmediate } from 'node:timers/promises'
import { ref, watch, nextTick, effectScope } from 'vue'

const source = readFileSync(new URL('../src/composables/useHorizontalDrag.ts', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/^export /gm, '')
const listeners = new Map(), mounted = [], unmounted = []
class Element { closest() { return this } getBoundingClientRect() { return { left: 280, right: 340 } } }
const selected = new Element()
const element = { scrollLeft: 0, scrollWidth: 500, clientWidth: 300, getBoundingClientRect: () => ({ left: 0, right: 300 }), querySelector: () => selected }
const container = ref(element), selection = ref('all')
const context = { ref, watch, nextTick, HTMLElement: Element,
  onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn),
  window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) } },
}
vm.createContext(context)
const scope = effectScope()
scope.run(() => vm.runInContext(ts.transpileModule(source + '\nglobalThis.check=useHorizontalDrag;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText, context))
let controls
scope.run(() => { controls = context.check(container, [selection]) })
mounted.forEach(fn => fn())
await nextTick(); await setImmediate()
assert.equal(container.value.scrollLeft, 40, 'the selected tab must remain in view')

const pointer = { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 160 }
let prevented = 0, stopped = 0
const move = x => listeners.get('pointermove')({ pointerId: 1, clientX: x, preventDefault: () => prevented++ })
controls.start(pointer)
move(157)
assert.equal(controls.dragging.value, false, 'small movements remain ordinary clicks')
move(100)
assert.equal(container.value.scrollLeft, 100)
assert.equal(controls.dragging.value, true)
listeners.get('pointerup')()
assert.equal(controls.dragging.value, false)
controls.guardClick({ detail: 1, preventDefault: () => prevented++, stopPropagation: () => stopped++ })
assert.equal(stopped, 1, 'the click after a drag must not change the selected tab')

controls.start(pointer); move(100); listeners.get('pointercancel')()
controls.guardClick({ detail: 0, preventDefault: () => prevented++, stopPropagation: () => stopped++ })
assert.equal(stopped, 1, 'keyboard activation remains usable after cancellation')
const before = container.value.scrollLeft
const previousPrevented = prevented
controls.start({ ...pointer, pointerType: 'touch' }); move(20)
assert.equal(container.value.scrollLeft, before, 'native touch scrolling is not replaced by mouse dragging')
assert.equal(prevented, previousPrevented, 'touch gestures are not prevented')
listeners.get('resize')()
assert.equal(container.value.scrollLeft, before + 40, 'resizing reveals the selected tab')
controls.focus({ target: selected })
assert.equal(container.value.scrollLeft, before + 80, 'keyboard focus reveals a clipped tab')
unmounted.forEach(fn => fn()); scope.stop()
assert.equal(listeners.size, 0, 'global listeners must be removed when leaving the page')
console.log('PASS: shared horizontal dragging, click suppression, native touch, keyboard visibility and cleanup')
