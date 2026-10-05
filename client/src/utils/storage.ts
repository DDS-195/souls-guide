// Browser policies and quota errors must not break authentication or startup.
// Failed writes remain visible in this tab; failed removals leave a tombstone
// so an old persisted token cannot silently become active again.
export function createSafeStorage(getStorage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const overrides = new Map<string, string | null>()
  return {
    getItem(key: string): string | null {
      if (overrides.has(key)) return overrides.get(key) ?? null
      try { return getStorage().getItem(key) } catch { return null }
    },
    setItem(key: string, value: string): boolean {
      try { getStorage().setItem(key, value); overrides.delete(key); return true }
      catch { overrides.set(key, value); return false }
    },
    removeItem(key: string): boolean {
      try { getStorage().removeItem(key); overrides.delete(key); return true }
      catch { overrides.set(key, null); return false }
    },
  }
}

export const safeStorage = createSafeStorage(() => localStorage)
