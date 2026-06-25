import express, { type Request, type Response } from 'express'

const app = express()
const PORT = Number(process.env.PORT ?? 3001)

app.use(express.json())

app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' })
})

app.listen(PORT, () => {
  console.log(`EduPay backend listening on http://localhost:${PORT}`)
})
