/** One source for grid columns, pagination and responsive image widths. */
export function homeLayout(viewportWidth: number, clientWidth = viewportWidth, measuredWidth?: number) {
  const mobile = viewportWidth < 768
  const narrow = viewportWidth < 1200
  const gap = mobile ? 10 : narrow ? 16 : 20
  // Estimate before mount; ResizeObserver supplies the actual content width afterwards.
  const available = Math.max(1, measuredWidth ?? (clientWidth - (mobile ? 28 : 220 + (narrow ? 32 : 64))))
  const minimum = narrow ? 240 : 260
  const columns = mobile ? 1 : Math.min(6, Math.max(1, Math.floor((available + gap) / (minimum + gap))))
  const imageWidth = Math.max(1, (available - (columns - 1) * gap) / columns - 2)
  return {
    columns, gap, pageSize: columns * Math.ceil(15 / columns), stackToolbar: available < 620,
    eagerCount: mobile ? 2 : columns, priorityCount: mobile ? 2 : columns,
    imageSizes: `${imageWidth}px`, maxImageWidth: columns === 1 ? 800 : 1280,
  }
}
