import express, { Request, Response } from 'express';
import crypto from 'crypto';
import Redis from 'ioredis';

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

// Connect to external Redis database
const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => {
  console.log(`[Database] Successfully connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`);
});

redis.on('error', (err) => {
  console.error(`[Database] Redis connection error:`, err.message);
});

// Generate 8-character random code [A-Za-z0-9]
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function generateCode(): string {
  let code = '';
  const randomBytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += CHARS[randomBytes[i] % CHARS.length];
  }
  return code;
}

app.use(express.json());

// Root endpoint: metadata
app.get('/', (_req: Request, res: Response) => {
  res.json({
    service: 'pastebin-typescript',
    description: 'Mini URL shortener pastebin API with Redis persistence',
    database: `Redis (${REDIS_HOST}:${REDIS_PORT})`,
    docs: '/paste',
  });
});

// Health endpoint for Docker HEALTHCHECK and monitoring
app.get('/health', async (_req: Request, res: Response) => {
  try {
    const pong = await redis.ping();
    if (pong === 'PONG') {
      res.status(200).json({ status: 'ok', database: 'connected' });
      return;
    }
    res.status(503).json({ status: 'degraded', database: 'unexpected response' });
  } catch (err: any) {
    res.status(503).json({ status: 'error', database: 'disconnected', details: err?.message });
  }
});

// POST /paste: create short URL
app.post('/paste', async (req: Request, res: Response) => {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string' || url.trim() === '') {
    res.status(400).json({ error: 'url is required' });
    return;
  }

  const trimmedUrl = url.trim();
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    res.status(400).json({ error: 'url must be a valid http(s) URL' });
    return;
  }

  try {
    let code: string;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
    } while ((await redis.exists(code)) === 1 && attempts < 10);

    // Save mapping into Redis
    await redis.set(code, trimmedUrl);

    res.status(201).json({
      code,
      short_url: `/${code}`,
      long_url: trimmedUrl,
    });
  } catch (err: any) {
    console.error('[Storage Error] Failed to persist URL:', err);
    res.status(500).json({ error: 'Database error', details: err?.message });
  }
});

// GET /:code: redirect to long URL
app.get('/:code', async (req: Request, res: Response) => {
  const rawCode = req.params.code;
  const code = Array.isArray(rawCode) ? rawCode[0] : rawCode;

  // Code must be exactly 8 alphanumeric characters
  if (!code || !/^[A-Za-z0-9]{8}$/.test(code)) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  try {
    const longUrl = await redis.get(code);
    if (!longUrl) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    res.redirect(302, longUrl);
  } catch (err: any) {
    console.error('[Storage Error] Failed to retrieve URL:', err);
    res.status(500).json({ error: 'Database error', details: err?.message });
  }
});

// 404 for unknown endpoints
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Pastebin listening on http://0.0.0.0:${PORT}`);
});
