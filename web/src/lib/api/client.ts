import createClient from 'openapi-fetch';
import { demoKeyHeaders } from '@/lib/demoKey';
import type { components, paths } from './schema';

/**
 * Typed client for the FastAPI server. `schema.d.ts` is generated from server/openapi.json:
 * run `make gen-api` after changing any route or model on the server.
 *
 * Same origin in every environment: Vite proxies /api in dev, FastAPI serves this build in prod.
 */
export const api = createClient<paths>({ baseUrl: '' });

api.use({
  onRequest({ request }) {
    for (const [name, value] of Object.entries(demoKeyHeaders())) {
      request.headers.set(name, value);
    }
    return request;
  },
});

export type Schemas = components['schemas'];
