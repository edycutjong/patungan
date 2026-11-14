import { expect, test } from '@playwright/test'

test('/judge returns 200 with the one-sentence claim and never asks for a wallet', async ({ page }) => {
  let walletRequested = false
  await page.addInitScript(() => {
    ;(window as unknown as { ethereum: unknown }).ethereum = {
      request: () => {
        ;(window as unknown as { __walletAsked: boolean }).__walletAsked = true
        return Promise.reject(new Error('no wallet in e2e'))
      },
      on: () => {},
    }
  })
  const res = await page.goto('/judge')
  expect(res?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/last seat pays the seller/i)
  await expect(page.getByRole('link', { name: /PAID pool/i }).first()).toHaveAttribute('href', '/p/mainnet-1/1')
  await expect(page.getByText('0x2f4646D52a5393E239f5b880411dC2CA2D945F31').first()).toBeVisible()
  walletRequested = await page.evaluate(() => !!(window as unknown as { __walletAsked?: boolean }).__walletAsked)
  expect(walletRequested).toBe(false)
})
