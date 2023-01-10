import * as log from "https://deno.land/std@0.163.0/log/mod.ts";
import { LokiHandler } from "./mod.ts";

log.setup({
  handlers: {
    localLokiHandler: new LokiHandler("DEBUG", {
      url: "http://localhost:3100",
      enableArgNaming: true,
    }),
  },
  loggers: {
    main: {
      handlers: ["localLokiHandler"],
      level: "DEBUG",
    },
  },
});

const logger = log.getLogger("main");

logger.info("Example Message");
logger.info("Example Message with Object", { foo: "bar" });
logger.info("Example Message with Named Object", ["ARGNAMES", "test"], {
  foo: "bar",
});
logger.info("Example Message with Named Object, and unnamed object", [
  "ARGNAMES",
  "test",
], {
  foo: "bar",
}, { bar: "baz" });
