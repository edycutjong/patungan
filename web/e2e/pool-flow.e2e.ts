import { expect, test } from '@playwright/test'

// Core flow, read-only: the two builder demo pools on QIE mainnet (evidence/mainnet-golive.md). No wallet needed.

test('pools list shows both mainnet demo pools with their final stamps', async ({ page }) => {
  await page.goto('/pools')
  await expect(page.getByText('Rehearsal PAID (builder wallets)')).toBeVisible()
  await expect(page.getByText('Badminton Saturday (builder wallets)')).toBeVisible()
  await expect(page.getByText('PAID IN FULL').first()).toBeVisible()
  await expect(page.getByText('REFUNDED').first()).toBeVisible()
})

test('opening the PAID pool from the list shows 2/2 seats and the payout to qkulk75527.qie', async ({ page }) => {
  await page.goto('/pools')
  await page.getByText('Rehearsal PAID (builder wallets)').click()
  await expect(page).toHaveURL(/\/p\/mainnet-1\/1$/)
  await expect(page.getByText('2/2')).toBeVisible()
  await expect(page.getByText(/Paid in full: 0\.50 QUSDC to qkulk75527\.qie/)).toBeVisible()
  await expect(page.getByText(/tx 0x4bd5c37d/)).toBeVisible() // last seat paid in QIE: swap + payout in one tx
})

test('the REFUNDED pool shows every member refunded after the deadline', async ({ page }) => {
  await page.goto('/p/mainnet-1/2')
  await expect(page.getByText('3/6')).toBeVisible()
  await expect(page.getByText(/Everyone was refunded: 3 members, 0\.75 QUSDC/)).toBeVisible()
  await expect(page.getByText('open seat')).toHaveCount(3)
})

test('start-a-pool form renders every field without a wallet', async ({ page }) => {
  await page.goto('/new')
  await expect(page.getByText(/What is it for\?/i)).toBeVisible()
  await expect(page.getByText(/Seats \(2–100\)/i)).toBeVisible()
  await expect(page.getByText(/Price per seat/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Create pool/i })).toBeVisible()
})
