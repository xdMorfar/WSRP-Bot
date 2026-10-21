type Level = 'debug' | 'info' | 'warn' | 'error';

const weight: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const configured = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;

function log(level: Level, message: string, meta?: unknown) {
  if ((weight[level] ?? 20) < (weight[configured] ?? 20)) return;
  const base = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  if (meta === undefined) console.log(base);
  else console.log(base, meta);
}

export const logger = {
  debug: (m: string, meta?: unknown) => log('debug', m, meta),
  info: (m: string, meta?: unknown) => log('info', m, meta),
  warn: (m: string, meta?: unknown) => log('warn', m, meta),
  error: (m: string, meta?: unknown) => log('error', m, meta),
};
