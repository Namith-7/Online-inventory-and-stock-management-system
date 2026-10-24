import { NextRequest, NextResponse } from 'next/server'
import { MovementType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { clearSession, getCurrentUser, hashPassword, requireAdmin, requireUser, setSession, verifyPassword } from '@/lib/server/auth'
import { checkLoginAttempt, jsonError, optionalText, requireDate, requireInteger, requirePrice, requireText } from '@/lib/server/http'

type Context = { params: Promise<{ path: string[] }> }


async function body(request: NextRequest) {
  try { return await request.json() as Record<string, unknown> } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { status: 400 })
  }
}

async function register(request: NextRequest) {
  const data = await body(request)
  const name = requireText(data.name, 'Name')
  const email = requireText(data.email, 'Email', 254).toLowerCase()
  const password = requireText(data.password, 'Password', 128)
  if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error('Enter a valid email address'), { status: 400 })
  if (password.length < 10) throw Object.assign(new Error('Password must be at least 10 characters'), { status: 400 })
  const workspaceName = requireText(data.workspaceName || `${name}'s Workspace`, 'Workspace name')
  const user = await prisma.$transaction(async tx => {
    const workspace = await tx.workspace.create({ data: { name: workspaceName } })
    const created = await tx.user.create({ data: { name, email, passwordHash: await hashPassword(password), workspaceId: workspace.id } })
    const supplierRows = [
      { name: 'TechSource India', email: 'contact@techsource.demo', phone: '+91 98765 11111', leadTime: 7 },
      { name: 'Circuit Hub', email: 'orders@circuithub.demo', phone: '+91 98765 22222', leadTime: 10 },
      { name: 'OfficeKart', email: 'sales@officekart.demo', phone: '+91 98765 33333', leadTime: 5 },
    ]
    const suppliers = await Promise.all(supplierRows.map(s => tx.supplier.create({ data: { ...s, workspaceId: workspace.id } })))
    await tx.category.createMany({ data: ['Electronics','Sensors','Accessories','Peripherals'].map(category => ({ workspaceId: workspace.id, name: category })) })
    await tx.brand.createMany({ data: ['Arduino','Circuit Hub','OfficeKart','Logitech','Keychron'].map(brand => ({ workspaceId: workspace.id, name: brand })) })
    await tx.workspaceSettings.create({ data: { workspaceId: workspace.id, currency: 'USD' } })
    const rows = [
      ['Arduino Uno','ARD-UNO-R3','Electronics','Arduino',24,12,29.9,suppliers[0].id,'Lab A','890100000001'],
      ['Temperature Sensor','SEN-TMP-01','Sensors','Circuit Hub',8,15,29.8,suppliers[1].id,'Lab A','890100000002'],
      ['USB Cable','CAB-USB-C-2M','Accessories','OfficeKart',0,20,8.5,suppliers[2].id,'Store Room','890100000003'],
      ['Wireless Mouse','MOU-WLS-02','Peripherals','Logitech',42,10,29.97,suppliers[2].id,'Store Room','890100000004'],
      ['Mechanical Keyboard','KEY-MECH-87','Peripherals','Keychron',6,8,89.9,suppliers[0].id,'Store Room','890100000005'],
    ] as const
    await tx.product.createMany({ data: rows.map(([productName,sku,category,brand,stock,minStock,price,supplierId,location,barcode]) => ({ workspaceId: workspace.id, name: productName, sku, category, brand, stock, minStock, price, supplierId, location, barcode })) })
    const seededProducts = await tx.product.findMany({ where: { workspaceId: workspace.id }, select: { id: true, location: true, stock: true } })
    await tx.stockBalance.createMany({ data: seededProducts.map(product => ({ workspaceId: workspace.id, productId: product.id, location: product.location, quantity: product.stock })) })
    return created
  })
  await setSession(user.id)
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, message: 'Workspace created with sample inventory' }, { status: 201 })
}

async function authRoute(path: string[], request: NextRequest) {
  if (path.length === 2 && path[1] === 'register' && request.method === 'POST') return register(request)
  if (path.length === 2 && path[1] === 'login' && request.method === 'POST') {
    const data = await body(request)
    const email = requireText(data.email, 'Email', 254).toLowerCase()
    const password = requireText(data.password, 'Password', 128)
    checkLoginAttempt(`${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'}:${email}`)
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw Object.assign(new Error('Email or password is incorrect'), { status: 401 })
    await setSession(user.id)
    return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } })
  }
  if (path.length === 2 && path[1] === 'logout' && request.method === 'POST') {
    await clearSession()
    return NextResponse.json({ ok: true })
  }
  if (path.length === 2 && path[1] === 'me' && request.method === 'GET') {
    const user = await getCurrentUser()
    return NextResponse.json({ user: user && { id: user.id, name: user.name, email: user.email, role: user.role, workspaceId: user.workspaceId } })
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { path } = await context.params
    if (!path.length || (path[0] === 'auth' && !['register','login','logout','me'].includes(path[1]))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (path[0] === 'auth') return await authRoute(path, request)
    const user = await requireUser()
    const wid = user.workspaceId
    if (path[0] === 'bootstrap') {
      const [products, suppliers, categories, brands, movements, orders, transfers, settings, workspace] = await Promise.all([
        prisma.product.findMany({ where: { workspaceId: wid }, include: { supplier: true }, orderBy: { createdAt: 'asc' } }),
        prisma.supplier.findMany({ where: { workspaceId: wid }, orderBy: { name: 'asc' } }),
        prisma.category.findMany({ where: { workspaceId: wid }, orderBy: { name: 'asc' } }),
        prisma.brand.findMany({ where: { workspaceId: wid }, orderBy: { name: 'asc' } }),
        prisma.stockMovement.findMany({ where: { workspaceId: wid }, include: { product: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }),
        prisma.purchaseOrder.findMany({ where: { workspaceId: wid }, include: { supplier: true, lines: { include: { product: true } } }, orderBy: { createdAt: 'desc' } }),
        prisma.stockTransfer.findMany({ where: { workspaceId: wid }, include: { product: true }, orderBy: { createdAt: 'desc' } }),
        prisma.workspaceSettings.findUnique({ where: { workspaceId: wid } }),
        prisma.workspace.findUnique({ where: { id: wid }, select: { name: true } }),
      ])
      return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, workspaceName: workspace?.name || 'Workspace', products, suppliers, categories: categories.map(x => x.name), brands: brands.map(x => x.name), movements, orders, transfers, settings })
    }
    if (path[0] === 'products') return NextResponse.json(await prisma.product.findMany({ where: { workspaceId: wid }, include: { supplier: true }, orderBy: { name: 'asc' } }))
    if (path[0] === 'suppliers') return NextResponse.json(await prisma.supplier.findMany({ where: { workspaceId: wid }, orderBy: { name: 'asc' } }))
    if (path[0] === 'categories') return NextResponse.json(await prisma.category.findMany({ where: { workspaceId: wid }, orderBy: { name: 'asc' } }))
    if (path[0] === 'brands') return NextResponse.json(await prisma.brand.findMany({ where: { workspaceId: wid }, orderBy: { name: 'asc' } }))
    if (path[0] === 'movements') return NextResponse.json(await prisma.stockMovement.findMany({ where: { workspaceId: wid }, include: { product: true }, orderBy: { createdAt: 'desc' }, take: 200 }))
    if (path[0] === 'orders') return NextResponse.json(await prisma.purchaseOrder.findMany({ where: { workspaceId: wid }, include: { supplier: true, lines: { include: { product: true } } }, orderBy: { createdAt: 'desc' } }))
    if (path[0] === 'transfers') return NextResponse.json(await prisma.stockTransfer.findMany({ where: { workspaceId: wid }, include: { product: true }, orderBy: { createdAt: 'desc' } }))
    if (path[0] === 'settings') return NextResponse.json(await prisma.workspaceSettings.findUnique({ where: { workspaceId: wid } }))
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) { return jsonError(error) }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { path } = await context.params
    if (!path.length || (path[0] === 'auth' && !['register','login','logout'].includes(path[1]))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (path[0] === 'auth') return await authRoute(path, request)
    const user = await requireAdmin()
    const wid = user.workspaceId
    const data = await body(request)
    if (path[0] === 'products') {
      const category = requireText(data.category, 'Category')
      const brand = requireText(data.brand, 'Brand')
      if (!await prisma.category.findUnique({ where: { workspaceId_name: { workspaceId: wid, name: category } } })) throw Object.assign(new Error('Choose a category from this workspace'), { status: 400 })
      if (!await prisma.brand.findUnique({ where: { workspaceId_name: { workspaceId: wid, name: brand } } })) throw Object.assign(new Error('Choose a brand from this workspace'), { status: 400 })
      const supplierId = optionalText(data.supplierId, 'Supplier')
      if (supplierId && !await prisma.supplier.findFirst({ where: { id: supplierId, workspaceId: wid } })) throw Object.assign(new Error('Supplier not found'), { status: 404 })
      const location = requireText(data.location || 'Store Room', 'Location')
      const stock = requireInteger(data.stock ?? 0, 'Stock')
      const barcode = optionalText(data.barcode, 'Barcode', 80)
      const product = await prisma.product.create({ data: {
        workspaceId: wid, name: requireText(data.name, 'Name'), sku: requireText(data.sku, 'SKU', 80).toUpperCase(),
        category, brand,
        stock, minStock: requireInteger(data.minStock ?? data.min ?? 0, 'Minimum stock'),
        price: requirePrice(data.price), supplierId,
        location, barcode,
        expiry: data.expiry ? requireDate(data.expiry, 'Expiry') : null,
        balances: { create: { workspaceId: wid, location, quantity: stock } },
      } })
      return NextResponse.json(product, { status: 201 })
    }
    if (path[0] === 'suppliers') {
      const email = requireText(data.email, 'Email', 254).toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error('Enter a valid supplier email address'), { status: 400 })
      const supplier = await prisma.supplier.create({ data: { workspaceId: wid, name: requireText(data.name, 'Name'), email, phone: optionalText(data.phone, 'Phone', 40), leadTime: requireInteger(data.leadTime ?? 7, 'Lead time', 1) } })
      return NextResponse.json(supplier, { status: 201 })
    }
    if (path[0] === 'categories' || path[0] === 'brands') {
      const name = requireText(data.name, 'Name')
      const item = path[0] === 'categories'
        ? await prisma.category.create({ data: { workspaceId: wid, name } })
        : await prisma.brand.create({ data: { workspaceId: wid, name } })
      return NextResponse.json(item, { status: 201 })
    }
    if (path[0] === 'movements') {
      const productId = requireText(data.productId, 'Product')
      const type = String(data.type || '').replaceAll(' ', '_').toUpperCase() as MovementType
      if (!Object.values(MovementType).includes(type)) throw Object.assign(new Error('Invalid stock movement type'), { status: 400 })
      if (type === 'TRANSFER') throw Object.assign(new Error('Use the transfers endpoint to move stock between locations'), { status: 400 })
      if (type === 'ADJUSTMENT' && data.delta === undefined) throw Object.assign(new Error('Adjustment requires a signed delta'), { status: 400 })
      if (type !== 'ADJUSTMENT' && data.quantity === undefined) throw Object.assign(new Error('Quantity is required for stock in/out'), { status: 400 })
      const quantity = requireInteger(Math.abs(Number(data.quantity ?? data.delta)), 'Quantity', 1)
      const signed = type === 'STOCK_OUT' ? -quantity : type === 'ADJUSTMENT' ? Number(data.delta) : quantity
      if (!Number.isInteger(signed) || signed === 0) throw Object.assign(new Error('Adjustment must be a non-zero whole number'), { status: 400 })
      const result = await prisma.$transaction(async tx => {
        const product = await tx.product.findFirst({ where: { id: productId, workspaceId: wid } })
        if (!product) throw Object.assign(new Error('Product not found'), { status: 404 })
        const location = typeof data.location === 'string' && data.location.trim() ? data.location.trim() : product.location
        if (signed < 0) {
          const removed = await tx.stockBalance.updateMany({ where: { productId, location, quantity: { gte: -signed } }, data: { quantity: { decrement: -signed } } })
          if (removed.count !== 1) throw Object.assign(new Error('Stock out quantity exceeds the available balance at this location'), { status: 409 })
          const updatedCount = await tx.product.updateMany({ where: { id: productId, workspaceId: wid, stock: { gte: -signed } }, data: { stock: { decrement: -signed } } })
          if (updatedCount.count !== 1) throw Object.assign(new Error('Stock out quantity cannot exceed total available stock'), { status: 409 })
        } else {
          await tx.stockBalance.upsert({ where: { productId_location: { productId, location } }, create: { workspaceId: wid, productId, location, quantity: signed }, update: { quantity: { increment: signed } } })
          await tx.product.updateMany({ where: { id: productId, workspaceId: wid }, data: { stock: { increment: signed } } })
        }
        const updated = await tx.product.findUniqueOrThrow({ where: { id: productId } })
        const movement = await tx.stockMovement.create({ data: { workspaceId: wid, productId, type, quantity: signed, location, reason: requireText(data.reason || 'Inventory update', 'Reason') } })
        return { product: updated, movement }
      })
      return NextResponse.json(result, { status: 201 })
    }
    if (path[0] === 'orders') {
      const supplierId = requireText(data.supplierId, 'Supplier')
      const lines = data.lines
      if (!Array.isArray(lines) || !lines.length) throw Object.assign(new Error('At least one order line is required'), { status: 400 })
      const normalized = lines.map(line => {
        if (!line || typeof line !== 'object') throw Object.assign(new Error('Each order line must be an object'), { status: 400 })
        const item = line as Record<string, unknown>
        return { productId: requireText(item.productId, 'Product'), quantity: requireInteger(item.quantity, 'Quantity', 1) }
      })
      if (normalized.length > 100) throw Object.assign(new Error('An order can contain at most 100 lines'), { status: 400 })
      if (new Set(normalized.map(line => line.productId)).size !== normalized.length) throw Object.assign(new Error('Each product can appear only once per order'), { status: 400 })
      const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, workspaceId: wid } })
      if (!supplier) throw Object.assign(new Error('Supplier not found'), { status: 404 })
      const products = await prisma.product.findMany({ where: { id: { in: normalized.map(l => l.productId) }, workspaceId: wid } })
      if (products.length !== normalized.length) throw Object.assign(new Error('One or more products were not found'), { status: 404 })
      const order = await prisma.purchaseOrder.create({ data: { workspaceId: wid, supplierId, lines: { create: normalized } }, include: { supplier: true, lines: { include: { product: true } } } })
      return NextResponse.json(order, { status: 201 })
    }
    if (path[0] === 'transfers') {
      const productId = requireText(data.productId, 'Product')
      const from = requireText(data.from, 'Source location')
      const to = requireText(data.to, 'Destination location')
      if (from === to) throw Object.assign(new Error('Source and destination must be different'), { status: 400 })
      const quantity = requireInteger(data.quantity, 'Quantity', 1)
      const transfer = await prisma.$transaction(async tx => {
        const product = await tx.product.findFirst({ where: { id: productId, workspaceId: wid } })
        if (!product) throw Object.assign(new Error('Product not found'), { status: 404 })
        const removed = await tx.stockBalance.updateMany({ where: { productId, location: from, quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } })
        if (removed.count !== 1) throw Object.assign(new Error('Transfer quantity exceeds the available balance at the source'), { status: 409 })
        const sourceLocation = product.location
        const destinationBalance = await tx.stockBalance.findUnique({ where: { productId_location: { productId, location: to } } })
        const destinationQuantity = destinationBalance?.quantity ?? 0
        const nextPrimaryLocation = from === sourceLocation && destinationQuantity === 0 ? to : sourceLocation
        const delta = (to === sourceLocation ? quantity : 0) - (from === sourceLocation ? quantity : 0)
        const changed = await tx.product.updateMany({
          where: { id: productId, workspaceId: wid, ...(delta < 0 ? { stock: { gte: -delta } } : {}) },
          data: { ...(delta ? { stock: { increment: delta } } : {}), ...(nextPrimaryLocation !== sourceLocation ? { location: nextPrimaryLocation } : {}) },
        })
        if (changed.count !== 1) throw Object.assign(new Error('Transfer quantity cannot exceed total available stock'), { status: 409 })
        if (to !== sourceLocation || from !== sourceLocation) {
          await tx.stockBalance.upsert({ where: { productId_location: { productId, location: to } }, create: { workspaceId: wid, productId, location: to, quantity }, update: { quantity: { increment: quantity } } })
        }
        const row = await tx.stockTransfer.create({ data: { workspaceId: wid, productId, from, to, quantity } })
        await tx.stockMovement.create({ data: { workspaceId: wid, productId, type: 'TRANSFER', quantity, location: to, reason: `Transfer ${quantity} from ${from} to ${to}` } })
        return { ...row, product: await tx.product.findUniqueOrThrow({ where: { id: productId } }) }
      })
      return NextResponse.json(transfer, { status: 201 })
    }
    if (path[0] === 'settings') {
      const settings = await prisma.workspaceSettings.upsert({ where: { workspaceId: wid }, create: { workspaceId: wid }, update: {
        ...(data.threshold !== undefined ? { threshold: requireInteger(data.threshold, 'Low stock threshold') } : {}),
        ...(data.expiryDays !== undefined ? { expiryDays: requireInteger(data.expiryDays, 'Expiry window') } : {}),
        ...(data.currency !== undefined ? { currency: requireText(data.currency, 'Currency', 3).toUpperCase() } : {}),
      } })
      return NextResponse.json(settings)
    }
    if (path[0] === 'profile') {
      const updated = await prisma.user.update({ where: { id: user.id }, data: { name: requireText(data.name, 'Name') }, select: { id: true, name: true, email: true, role: true } })
      return NextResponse.json(updated)
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) { return jsonError(error) }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { path } = await context.params
    if (!path.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const user = await requireAdmin()
    const wid = user.workspaceId
    const data = await body(request)
    if (path[0] === 'settings') return NextResponse.json(await prisma.workspaceSettings.update({ where: { workspaceId: wid }, data: {
      ...(data.threshold !== undefined ? { threshold: requireInteger(data.threshold, 'Low stock threshold') } : {}),
      ...(data.expiryDays !== undefined ? { expiryDays: requireInteger(data.expiryDays, 'Expiry window') } : {}),
      ...(data.currency !== undefined ? { currency: requireText(data.currency, 'Currency', 3).toUpperCase() } : {}),
    } }))
    if (!['products', 'suppliers', 'orders'].includes(path[0])) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const id = requireText(path[1], 'ID')
    if (path[0] === 'products') {
      const existing = await prisma.product.findFirst({ where: { id, workspaceId: wid } })
      if (!existing) throw Object.assign(new Error('Product not found'), { status: 404 })
      if (data.category !== undefined && !await prisma.category.findUnique({ where: { workspaceId_name: { workspaceId: wid, name: requireText(data.category, 'Category') } } })) throw Object.assign(new Error('Choose a category from this workspace'), { status: 400 })
      if (data.brand !== undefined && !await prisma.brand.findUnique({ where: { workspaceId_name: { workspaceId: wid, name: requireText(data.brand, 'Brand') } } })) throw Object.assign(new Error('Choose a brand from this workspace'), { status: 400 })
      if (data.supplierId) {
        const supplier = await prisma.supplier.findFirst({ where: { id: requireText(data.supplierId, 'Supplier'), workspaceId: wid } })
        if (!supplier) throw Object.assign(new Error('Supplier not found'), { status: 404 })
      }
      const product = await prisma.$transaction(async tx => {
        const nextLocation = data.location !== undefined ? requireText(data.location, 'Location') : existing.location
        if (nextLocation !== existing.location) {
          const balance = await tx.stockBalance.findUnique({ where: { productId_location: { productId: id, location: existing.location } } })
          if (balance && balance.quantity > 0) {
            await tx.stockBalance.upsert({ where: { productId_location: { productId: id, location: nextLocation } }, create: { workspaceId: wid, productId: id, location: nextLocation, quantity: balance.quantity }, update: { quantity: { increment: balance.quantity } } })
            await tx.stockBalance.update({ where: { id: balance.id }, data: { quantity: 0 } })
          }
        }
        return tx.product.update({ where: { id }, data: {
        ...(data.name !== undefined ? { name: requireText(data.name, 'Name') } : {}),
        ...(data.sku !== undefined ? { sku: requireText(data.sku, 'SKU', 80).toUpperCase() } : {}),
        ...(data.category !== undefined ? { category: requireText(data.category, 'Category') } : {}),
        ...(data.brand !== undefined ? { brand: requireText(data.brand, 'Brand') } : {}),
        ...(data.minStock !== undefined ? { minStock: requireInteger(data.minStock, 'Minimum stock') } : {}),
        ...(data.price !== undefined ? { price: requirePrice(data.price) } : {}),
        ...(data.supplierId !== undefined ? { supplierId: optionalText(data.supplierId, 'Supplier') } : {}),
        ...(data.location !== undefined ? { location: nextLocation } : {}),
        ...(data.barcode !== undefined ? { barcode: optionalText(data.barcode, 'Barcode', 80) } : {}),
        ...(data.expiry !== undefined ? { expiry: data.expiry ? requireDate(data.expiry, 'Expiry') : null } : {}),
        } })
      })
      return NextResponse.json(product)
    }
    if (path[0] === 'suppliers') {
      const existing = await prisma.supplier.findFirst({ where: { id, workspaceId: wid } })
      if (!existing) throw Object.assign(new Error('Supplier not found'), { status: 404 })
      const email = data.email !== undefined ? requireText(data.email, 'Email', 254).toLowerCase() : existing.email
      if (!/^\S+@\S+\.\S+$/.test(email)) throw Object.assign(new Error('Enter a valid supplier email address'), { status: 400 })
      return NextResponse.json(await prisma.supplier.update({ where: { id }, data: {
        ...(data.name !== undefined ? { name: requireText(data.name, 'Name') } : {}),
        ...(data.email !== undefined ? { email } : {}),
        ...(data.phone !== undefined ? { phone: optionalText(data.phone, 'Phone', 40) } : {}),
        ...(data.leadTime !== undefined ? { leadTime: requireInteger(data.leadTime, 'Lead time', 1) } : {}),
      } }))
    }
    if (path[0] === 'orders') {
      const order = await prisma.purchaseOrder.findFirst({ where: { id, workspaceId: wid } })
      if (!order) throw Object.assign(new Error('Purchase order not found'), { status: 404 })
      const action = data.action
      if (action === 'order' && order.status === 'DRAFT') {
        const changed = await prisma.purchaseOrder.updateMany({ where: { id, workspaceId: wid, status: 'DRAFT' }, data: { status: 'ORDERED' } })
        if (!changed.count) throw Object.assign(new Error('Purchase order status changed; refresh and try again'), { status: 409 })
        return NextResponse.json(await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { supplier: true, lines: { include: { product: true } } } }))
      }
      if (action === 'cancel' && (order.status === 'DRAFT' || order.status === 'ORDERED')) {
        const changed = await prisma.purchaseOrder.updateMany({ where: { id, workspaceId: wid, status: order.status }, data: { status: 'CANCELLED' } })
        if (!changed.count) throw Object.assign(new Error('Purchase order status changed; refresh and try again'), { status: 409 })
        return NextResponse.json(await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } }))
      }
      if (action === 'receive' && order.status === 'ORDERED') {
        const received = await prisma.$transaction(async tx => {
          const claimed = await tx.purchaseOrder.updateMany({ where: { id, workspaceId: wid, status: 'ORDERED' }, data: { status: 'RECEIVED', receivedAt: new Date() } })
          if (!claimed.count) throw Object.assign(new Error('Purchase order has already changed status'), { status: 409 })
          const lines = await tx.purchaseOrderLine.findMany({ where: { orderId: id } })
          for (const line of lines) {
            const changed = await tx.product.updateMany({ where: { id: line.productId, workspaceId: wid }, data: { stock: { increment: line.quantity } } })
            if (!changed.count) throw Object.assign(new Error('An ordered product no longer exists in this workspace'), { status: 409 })
            const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId }, select: { location: true } })
            await tx.stockBalance.upsert({ where: { productId_location: { productId: line.productId, location: product.location } }, create: { workspaceId: wid, productId: line.productId, location: product.location, quantity: line.quantity }, update: { quantity: { increment: line.quantity } } })
            await tx.stockMovement.create({ data: { workspaceId: wid, productId: line.productId, type: 'STOCK_IN', quantity: line.quantity, location: product.location, reason: `Purchase order ${id} received` } })
          }
          return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { supplier: true, lines: { include: { product: true } } } })
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
        return NextResponse.json(received)
      }
      throw Object.assign(new Error('Invalid order action for its current status'), { status: 409 })
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  } catch (error) { return jsonError(error) }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { path } = await context.params
    if (!path.length || !['products','suppliers','categories','brands'].includes(path[0])) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const user = await requireAdmin()
    const id = requireText(path[1], 'ID')
    if (path[0] === 'products') {
      const product = await prisma.product.findFirst({ where: { id, workspaceId: user.workspaceId } })
      if (!product) throw Object.assign(new Error('Product not found'), { status: 404 })
      await prisma.product.delete({ where: { id } })
    } else if (path[0] === 'suppliers') {
      const supplier = await prisma.supplier.findFirst({ where: { id, workspaceId: user.workspaceId } })
      if (!supplier) throw Object.assign(new Error('Supplier not found'), { status: 404 })
      await prisma.supplier.delete({ where: { id } })
    } else if (path[0] === 'categories' || path[0] === 'brands') {
      if (path[0] === 'categories') {
        const item = await prisma.category.findFirst({ where: { id, workspaceId: user.workspaceId } })
        if (!item) throw Object.assign(new Error('Category not found'), { status: 404 })
        const assigned = await prisma.product.count({ where: { workspaceId: user.workspaceId, category: item.name } })
        if (assigned) throw Object.assign(new Error('Reassign products before deleting this value'), { status: 409 })
        await prisma.category.delete({ where: { id } })
      } else {
        const item = await prisma.brand.findFirst({ where: { id, workspaceId: user.workspaceId } })
        if (!item) throw Object.assign(new Error('Brand not found'), { status: 404 })
        const assigned = await prisma.product.count({ where: { workspaceId: user.workspaceId, brand: item.name } })
        if (assigned) throw Object.assign(new Error('Reassign products before deleting this value'), { status: 409 })
        await prisma.brand.delete({ where: { id } })
      }
    } else return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) { return jsonError(error) }
}

