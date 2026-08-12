import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db, sql } from './client.js'
import { users } from './schema.js'

const email = (process.env.ADMIN_EMAIL ?? 'admin@local.dev').toLowerCase()
const password = process.env.ADMIN_PASSWORD

if (!password) {
  throw new Error('ADMIN_PASSWORD is required to seed the administrator')
}

const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)

if (!existing) {
  await db.insert(users).values({
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'admin',
  })
  console.log(`Created administrator ${email}`)
}

await sql.end()
