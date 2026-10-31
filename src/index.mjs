// Library entry: embed the DogPolicies server in your own process, or build
// another server on the same core (see "./core").

export {
  createRuntime,
  createServer,
  readConfig,
  toolDefinitions,
} from "./dogpolicies/server.mjs";
export { connectInProcess } from "./dogpolicies/connect.mjs";
export { createHttpHandler, listen } from "./core/http.mjs";
export {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  REGISTRY_NAME,
  ENV,
  DEFAULT_BASE_URL,
} from "./config.mjs";
