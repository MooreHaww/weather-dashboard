const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

export function createLogger(minLevel: string = 'info') {
  const min = LEVELS[(minLevel as Level) in LEVELS ? (minLevel as Level) : 'info'];
  return (level: Level, msg: string) => {
    if (LEVELS[level] < min) return;
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  };
}
