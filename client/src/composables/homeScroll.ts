// Keep only the most recent homepage locations; no persistent user data.
export const homeScroll = new Map<string, number>()
export function rememberHomeScroll(key: string) {
  homeScroll.delete(key)
  homeScroll.set(key, window.scrollY)
  if (homeScroll.size > 30) homeScroll.delete(homeScroll.keys().next().value!)
}
