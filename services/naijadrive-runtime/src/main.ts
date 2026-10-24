import 'reflect-metadata'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { loadRuntimeConfig } from './config/runtime-config.js'
import { runMigrations } from './infra/migrations.js'
import { assertPostgresReady, createPostgresPool } from './infra/postgres.js'
import { RedisPresenceStore } from './infra/redis-presence.js'

async function bootstrap() {
  const config = loadRuntimeConfig()
  const pool = createPostgresPool(config)
  const presence = new RedisPresenceStore(config)
  await assertPostgresReady(pool)
  await runMigrations(pool, new URL('../../migrations/', import.meta.url).pathname)
  await presence.connect()
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())
  app.enableShutdownHooks()
  await app.listen(config.port, '0.0.0.0')
  const shutdown = async () => {
    await app.close()
    await presence.close()
    await pool.end()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

bootstrap().catch((error) => {
  console.error('NaijaDrive runtime refused to start:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
