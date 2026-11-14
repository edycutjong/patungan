import { expect, test } from '@playwright/test'

const widths = [375, 768, 1440]
const pages = ['/', '/pools', '/p/mainnet-1/1', '/judge']

for (const width of widths) {
  for (const path of pages) {
    test(`no horizontal scroll at ${width}px on ${path}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      // What a user feels: try to scroll sideways. (The landing clips decorative overflow with `overflow-x: clip`.)
      const scrollX = await page.evaluate(() => {
        window.scrollTo(10_000, 0)
        return window.scrollX
      })
      expect(scrollX).toBe(0)
    })
  }
}
