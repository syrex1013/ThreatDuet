import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

export const json = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) return c.json({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  });
