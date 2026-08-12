import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

const useSsl =
  process.env.DATABASE_SSL === 'true' ||
  connectionString.includes('sslmode=require') ||
  connectionString.includes('ssl=true')

export const sql = postgres(connectionString, {
  ...(useSsl ? { ssl: 'require' } : {}),
})
export const db = drizzle(sql, { schema })
