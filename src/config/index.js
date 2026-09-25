/* Config Barrel */
import { env } from "./env.js";

export { env } from "./env.js";

export const config = {
  env,
  http: {
    host: "0.0.0.0",
  },
  api: {
    root: "/api",
    version: "/v1",
  },
  cookie: {
    refresh: {
      name: (realm) => `belioras_refresh_${realm}`,
      path: "/api/v1/auth",
      httpOnly: true,
      sameSite: "lax",
      secure: env.isProduction,
    },
  },
};