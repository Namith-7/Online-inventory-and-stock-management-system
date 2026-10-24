export async function apiRequest<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`)
  return payload as T
}

export function productFromApi(row: any) {
  return { id: row.id, name: row.name, sku: row.sku, category: row.category, brand: row.brand, stock: row.stock, min: row.minStock, price: row.price, supplier: row.supplier?.name || '', supplierId: row.supplierId || '', location: row.location, barcode: row.barcode || '', expiry: row.expiry ? new Date(row.expiry).toISOString().slice(0, 10) : undefined }
}

export function movementFromApi(row: any) {
  const names: Record<string, string> = { STOCK_IN: 'Stock in', STOCK_OUT: 'Stock out', ADJUSTMENT: 'Adjustment', TRANSFER: 'Transfer' }
  return { id: row.id, product: row.product?.name || 'Product', type: names[row.type] || row.type, qty: row.quantity, reason: row.reason, date: new Date(row.createdAt).toLocaleString() }
}

export function orderFromApi(row: any) {
  const names: Record<string, string> = { DRAFT: 'Draft', ORDERED: 'Ordered', RECEIVED: 'Received', CANCELLED: 'Cancelled' }
  return { id: row.id, supplier: row.supplier?.name || 'Supplier', status: names[row.status] || row.status, received: row.status === 'RECEIVED', lines: row.lines.map((line: any) => ({ productId: line.productId, quantity: line.quantity })) }
}

