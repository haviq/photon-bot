// Photon Beta — Telegram bot bridge
// Connects to Photon event stream (Socket.IO), receives deliveries, replies.
import { io } from "socket.io-client";
import fs from "node:fs";

const ORIGIN = process.env.PHOTON_API_ORIGIN ?? "https://api.photon.codes";
const PROJECT_ID = process.env.PHOTON_PROJECT_ID;
const API_KEY = process.env.PHOTON_API_KEY;
const CURSOR_FILE = process.env.CURSOR_FILE ?? "./cursor.json";
const BOT_NAME = process.env.BOT_NAME ?? "photon-bot";

if (!PROJECT_ID || !API_KEY) {
  console.error("Missing PHOTON_PROJECT_ID or PHOTON_API_KEY");
  process.exit(1);
}

function loadCursor() {
  try { return JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8")).cursor ?? 0; }
  catch { return 0; }
}
function saveCursor(cursor) {
  try { fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor, ts: Date.now() })); }
  catch (e) { console.error("cursor save failed", e.message); }
}

let cursor = loadCursor();
let epoch = 0;
let pending = 0;
let queue = Promise.resolve();

const socket = io(ORIGIN, {
  path: `/v1/projects/${PROJECT_ID}/events/ws`,
  addTrailingSlash: false,
  transports: ["websocket"],
  extraHeaders: { Authorization: `Bearer ${API_KEY}` },
  autoConnect: false,
});

socket.on("connect", () => {
  console.log(`[${BOT_NAME}] connected, subscribing from seq=${cursor}`);
  socket.timeout(10000).emit("subscribe", { startSeq: cursor }, (error, result) => {
    if (error) { console.error("subscribe timeout", error.message); socket.io.engine.close(); return; }
    if (!result?.ok) { console.error("subscribe rejected", result?.error?.code); return; }
    console.log("[subscribed]", result.connectionId, "apiVersion", result.apiVersion);
  });
});

socket.on("disconnect", (reason) => { epoch++; console.log("[disconnect]", reason); });
socket.on("connect_error", (e) => console.error("[connect_error]", e.message));
socket.on("delivery_error", (e) => console.error("[delivery_error]", e.code));

socket.on("delivery", (event, meta) => {
  const { seq, replyExpected } = meta;
  const generation = epoch;
  if (++pending > 128) { pending--; epoch++; socket.io.engine.close(); return; }
  queue = queue.then(async () => {
    if (generation !== epoch || seq <= cursor) return;
    console.log(`[event seq=${seq} replyExpected=${replyExpected}]`, JSON.stringify(event).slice(0, 800));
    if (replyExpected) await handleReply(event);
    saveCursor(seq);
    cursor = seq;
  }).catch((err) => {
    console.error("[handler error]", err.message);
    if (generation === epoch) { epoch++; socket.io.engine.close(); }
  }).finally(() => { pending--; });
});

// Build a plain-text response for the incoming message.
function buildText(event) {
  // Try to pull the user's message text out of the event.
  const data = event?.data ?? event?.payload ?? {};
  const text = data?.text ?? data?.message?.text ?? data?.content?.text ?? "";
  if (!text) return "ping? (bot online)";
  if (/^\/?ping\b/i.test(text)) return "pong \ud83c\udfc3";
  return `Echo: ${text}`;
}

async function handleReply(event) {
  const body = Buffer.from(buildText(event), "utf8").toString("base64");
  await new Promise((resolve) => {
    socket.timeout(5000).emit("reply", {
      eventId: event.id,
      status: 200,
      headers: { "content-type": "text/plain" },
      body,
    }, (error, result) => {
      if (error) console.error("reply timeout (outcome unknown)");
      else if (!result?.ok) console.error("reply rejected", result?.error?.code);
      else console.log("reply accepted for event", event.id);
      resolve();
    });
  });
}

process.on("SIGINT", () => { saveCursor(cursor); socket.close(); process.exit(0); });
process.on("SIGTERM", () => { saveCursor(cursor); socket.close(); process.exit(0); });

socket.connect();
console.log(`[${BOT_NAME}] starting (project=${PROJECT_ID})`);
