import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { wrapAsync } from './wrap-async'

const req = {} as Request
const res = {} as Response

// Let the promise rejection settle before asserting on next().
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('wrapAsync', () => {
  it('forwards a rejected handler to next(error)', async () => {
    const next = vi.fn()
    const error = new Error('boom')

    wrapAsync(async () => {
      throw error
    })(req, res, next)
    await flush()

    expect(next).toHaveBeenCalledWith(error)
  })

  it('does not call next when the handler resolves', async () => {
    const next = vi.fn()

    wrapAsync(async () => undefined)(req, res, next)
    await flush()

    expect(next).not.toHaveBeenCalled()
  })
})
