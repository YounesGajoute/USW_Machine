/**
 * Load backend/.env before any module reads process.env.
 * systemd sources .env before npm start; direct `node index.mjs` does not.
 */
import { loadBackendEnv } from './loadBackendEnv.mjs'

const result = loadBackendEnv()
if (result.loaded && result.keys > 0) {
  console.log(`[Env] Loaded ${result.keys} key(s) from ${result.path}`)
}
