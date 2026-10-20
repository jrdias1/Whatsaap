import { PrismaClient } from '@prisma/client'

const tenantSlug = process.argv[2]
if (!tenantSlug) {
  process.stderr.write('Uso: node scripts/audit-message-encoding.mjs <slug-do-tenant>\n')
  process.exit(2)
}

const db = new PrismaClient()
try {
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true } })
  if (!tenant) throw new Error('Clínica não encontrada.')
  const [{ server_encoding: serverEncoding }] = await db.$queryRaw`SHOW server_encoding`
  let cursor
  let total = 0
  const suspicious = []
  for (;;) {
    const rows = await db.message.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, body: true, createdAt: true },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (!rows.length) break
    total += rows.length
    for (const row of rows) {
      if (/\uFFFD|Ã[\u0080-\u00bf]|Â[\u00a0-\u00bf]|â[\u0080-\u009f]|[\p{Ll}]\?{1,2}[\p{Ll}]|\\(?:u[0-9a-f]{4}|x[0-9a-f]{2})/iu.test(row.body)) {
        suspicious.push({ id: row.id, createdAt: row.createdAt })
      }
    }
    cursor = rows.at(-1).id
  }
  process.stdout.write(JSON.stringify({ tenant: tenantSlug, serverEncoding, total, suspiciousCount: suspicious.length, suspicious }, null, 2) + '\n')
  if (suspicious.length) process.exitCode = 1
} finally {
  await db.$disconnect()
}
