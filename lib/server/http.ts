import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'

export function jsonError(error: unknown) {
  const candidate = error as { status?: number; message?: string; code?: string }
  if (candidate?.status) return NextResponse.json({ error: candidate.message }, { status: candidate.status })
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return NextResponse.json({ error: 'A record with that value already exists' }, { status: 409 })
    if (error.code === 'P2025') return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    if (error.code === 'P2003') return NextResponse.json({ error: 'This record is still referenced by inventory history or an order' }, { status: 409 })
    if (error.code === 'P2034') return NextResponse.json({ error: 'This inventory record changed concurrently. Refresh and retry.' }, { status: 409 })
  }
  console.error(error)
  return NextResponse.json({ error: 'An unexpected server error occurred' }, { status: 500 })
}

export function requireText(value: unknown, label: string, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw Object.assign(new Error(`${label} is required (max ${max} characters)`), { status: 400 })
  }
  return value.trim()
}

export function requireInteger(value: unknown, label: string, min = 0) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min) throw Object.assign(new Error(`${label} must be a whole number of at least ${min}`), { status: 400 })
  return number
}

export function requirePrice(value: unknown) {
  const price = Number(value)
  if (!Number.isFinite(price) || price < 0) throw Object.assign(new Error('Price must be a non-negative number'), { status: 400 })
  return price
}

export function optionalText(value: unknown, label: string, max = 160) {
  if (value === undefined || value === null || value === '') return null
  return requireText(value, label, max)
}

export function requireDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) {
    throw Object.assign(new Error(`${label} must be a valid date`), { status: 400 })
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw Object.assign(new Error(`${label} must be a valid date`), { status: 400 })
  return date
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_ATTEMPT_LIMIT = 10

export function checkLoginAttempt(key: string) {
  const now = Date.now()
  const current = loginAttempts.get(key)
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return
  }
  current.count += 1
  if (current.count > LOGIN_ATTEMPT_LIMIT) {
    throw Object.assign(new Error('Too many sign-in attempts. Try again in 15 minutes.'), { status: 429 })
  }
}

