import { expect, test } from '@playwright/test'

const CONTRACT = '0x2f4646D52a5393E239f5b880411dC2CA2D945F31'

test('landing page loads with title, mainnet status and social card, and throws no page errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page).toHaveTitle(/Patungan/)
  await expect(page.getByText(/live on QIE mainnet/i).first()).toBeVisible()
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /og\.png(\?v=\w+)?$/)
  await expect(page.getByRole('link', { name: /Open the app/i }).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('verify page reads the verified contract and its four QIE components from mainnet', async ({ page }) => {
  await page.goto('/verify')
  await expect(page.getByText(CONTRACT).first()).toBeVisible()
  await expect(page.getByText(/Source verified on Blockscout/i)).toBeVisible()
  for (const label of ['QUSDC', 'Router', 'Zone', 'Oracle']) await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
})

test('pitch deck is served at /pitch/', async ({ page }) => {
  const res = await page.goto('/pitch/')
  expect(res?.status()).toBe(200)
  await expect(page).toHaveTitle(/pitch deck/i)
})

test('unknown path falls back without a crash', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/p/mainnet-1/999999')
  await expect(page.locator('body')).not.toBeEmpty()
  expect(errors).toEqual([])
})
