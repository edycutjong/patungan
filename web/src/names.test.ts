import { describe, expect, it } from 'vitest'
import { ageHours, toQieLabel } from './names'

describe('toQieLabel', () => {
  it('lowercases and strips .qie and @', () => {
    expect(toQieLabel('  Bob.QIE ')).toBe('bob')
    expect(toQieLabel('@lapangan')).toBe('lapangan')
    expect(toQieLabel('test')).toBe('test')
  })
})

describe('ageHours', () => {
  it('floors to whole hours and never goes negative', () => {
    expect(ageHours(1000n, 1000 + 3 * 3600 + 59)).toBe(3)
    expect(ageHours(5000n, 1000)).toBe(0)
  })
})
