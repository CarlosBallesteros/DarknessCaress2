// Express app (docs/01). One process does everything; static SPA serving in
// production arrives with the frontend phase (docs/09 phase 6).
import express from 'express'
import { env } from './env'

const app = express()

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

// Vitest imports the app to exercise it against an ephemeral port; only a real
// run should open the configured port.
if (process.env.NODE_ENV !== 'test') {
  app.listen(env.PORT, () => {
    console.log(`Darkness Caress II server listening on port ${env.PORT}`)
  })
}

export default app
