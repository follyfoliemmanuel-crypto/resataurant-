
import type { IncomingMessage, ServerResponse } from "node:http";
import { server } from "../server/index.js";

export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  server.emit("request", req, res);
}
