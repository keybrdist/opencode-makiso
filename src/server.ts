#!/usr/bin/env node
import http, { type IncomingMessage } from "node:http";
import { getDefaultConfig, getWebhookConfig } from "./config.js";
import { openDatabase } from "./db/client.js";
import { insertEvent } from "./db/events.js";
import { insertMentions } from "./db/mentions.js";
import { insertToolCalls } from "./db/tools.js";

const readBody = (req: IncomingMessage): Promise<string> => {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
};

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
};

const forbidden = (res: http.ServerResponse) => {
  json(res, 403, { error: "forbidden" });
};

const badRequest = (res: http.ServerResponse, message: string) => {
  json(res, 400, { error: message });
};

const notFound = (res: http.ServerResponse) => {
  json(res, 404, { error: "not_found" });
};

const matchTopic = (path: string, routeMap: Record<string, string>): string | null => {
  const trimmed = path.replace(/\?.*$/, "");
  const key = trimmed.replace(/^\//, "").replace(/\/+$/, "");
  if (!key) return null;
  return routeMap[key] ?? null;
};

const verifySecret = (req: IncomingMessage, secret: string | null): boolean => {
  if (!secret) return true;
  const header = req.headers["x-oc-events-secret"];
  if (!header) return false;
  if (Array.isArray(header)) return header.includes(secret);
  return header === secret;
};

const parsePayload = (body: string) => {
  if (!body.trim()) {
    return { body: "", metadata: null };
  }

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const payloadBody = parsed.body ?? parsed.message ?? parsed.text ?? "";
    const metadata = JSON.stringify(parsed, null, 2);
    return { body: String(payloadBody), metadata };
  } catch {
    return { body, metadata: null };
  }
};

const startServer = () => {
  const config = getDefaultConfig();
  const webhook = getWebhookConfig();
  const db = openDatabase({ path: config.dbPath });

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      notFound(res);
      return;
    }

    if (req.method !== "POST") {
      badRequest(res, "only POST is supported");
      return;
    }

    if (!verifySecret(req, webhook.secret)) {
      forbidden(res);
      return;
    }

    const topic = matchTopic(req.url, webhook.routeMap);
    if (!topic) {
      notFound(res);
      return;
    }

    try {
      const body = await readBody(req);
      const parsed = parsePayload(body);
      if (!parsed.body) {
        badRequest(res, "body is required");
        return;
      }

      const event = insertEvent(db, {
        topic,
        body: parsed.body,
        metadata: parsed.metadata,
        source: webhook.source
      });

      insertMentions(db, event.id, event.body);
      insertToolCalls(db, event.id, event.body);

      json(res, 200, event);
    } catch (error) {
      json(res, 500, { error: "server_error" });
    }
  });

  server.listen(webhook.port, () => {
    process.stdout.write(`oc-events webhook listening on ${webhook.port}\n`);
  });
};

startServer();
