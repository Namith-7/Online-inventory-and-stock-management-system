import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

const scrypt = promisify(scryptCallback)
const COOKIE_NAME = 'stockwise_session'
const SESSION_DAYS = 7

function secret() {
  const value = process.env.SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters')
  return value
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scrypt(password, salt, 64)) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const derived = (await scrypt(password, salt, 64)) as Buffer
  const expected = Buffer.from(hash, 'hex')
  return expected.length === derived.length && timingSafeEqual(expected, derived)
}

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

function createToken(userId: string) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + SESSION_DAYS * 86400000 })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function readToken(token?: string) {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = Buffer.from(sign(payload))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof data.sub === 'string' && data.exp > Date.now() ? data.sub as string : null
  } catch { return null }
}

export async function setSession(userId: string) {
  const jar = await cookies()
  jar.set(COOKIE_NAME, createToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  })
}

export async function clearSession() {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}

export async function getCurrentUser() {
  const jar = await cookies()
  const id = readToken(jar.get(COOKIE_NAME)?.value)
  if (!id) return null
  return prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, role: true, workspaceId: true } })
}

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) throw Object.assign(new Error('Sign in is required'), { status: 401 })
  return user
}

export async function requireAdmin() {
  const user = await requireUser()
  if (user.role !== 'ADMIN') throw Object.assign(new Error('Administrator access is required'), { status: 403 })
  return user
}

