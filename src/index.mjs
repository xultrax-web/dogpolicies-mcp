// Library entry: embed the Dog Rulebook server in your own process, or build
// another server on the same core (see "./core").

export {
  createRuntime,
  createServer,
  readConfig,
  toolDefinitions,
} from "./dogrulebook/server.mjs";
export { connectInProcess } from "./dogrulebook/connect.mjs";
export { createHttpHandler, listen } from "./core/http.mjs";
export {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  REGISTRY_NAME,
  ENV,
  DEFAULT_BASE_URL,
} from "./config.mjs";
