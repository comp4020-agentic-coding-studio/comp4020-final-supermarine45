import express, { type ErrorRequestHandler } from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { attachUser, userFromSocketCookie } from "./auth.js";
import { openDb } from "./db.js";
import { configureLogger, logStatus } from "./logger.js";
import { authRouter } from "./routes/auth.js";
import { pagesRouter } from "./routes/pages.js";
import { scheduleRouter } from "./routes/schedule.js";
import { registerSocketHandlers, rearmTimers } from "./rooms.js";

const PORT = Number(process.env.PORT ?? 8080);
const DB_PATH = process.env.DB_PATH ?? "./data/app.db";
const README_PATH = process.env.README_PATH ?? "./README.md";

// Configured before openDb so a startup failure below already has somewhere
// persistent to write to.
configureLogger(DB_PATH);
let db;
try {
  db = openDb(DB_PATH);
} catch (err) {
  logStatus("ERROR", `Failed to open database at ${DB_PATH}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  throw err;
}

const app = express();
// Created before routes are mounted so scheduleRouter can close over io to
// re-broadcast a room when a planned session is added or cancelled.
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use(attachUser(db));
app.use(express.static("public"));
app.use("/auth", authRouter(db, io));
app.use(pagesRouter(db, README_PATH));
app.use(scheduleRouter(db, io));

app.get("/", (_req, res) => {
  res.sendFile("index.html", { root: "public" });
});

// Malformed input (e.g. a bad JSON body caught by express.json()) is the
// client's fault, not the server's — logged as a WARN. Anything else here is
// a bug in our own route code, so it's an ERROR and still gets a 500.
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof SyntaxError) {
    logStatus("WARN", `Malformed request body on ${req.method} ${req.path}: ${err.message}`);
    res.status(400).json({ error: "malformed request body" });
    return;
  }
  logStatus("ERROR", `Unhandled error on ${req.method} ${req.path}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  res.status(500).json({ error: "internal server error" });
};
app.use(errorHandler);

io.use((socket, next) => {
  socket.data.user = userFromSocketCookie(db, socket.handshake.headers.cookie);
  next();
});

registerSocketHandlers(io, db);
rearmTimers(io, db);

// Catch-all so a bug anywhere in a socket handler or an unawaited promise
// shows up as one ERROR line in status.log instead of silently killing the
// process (or, worse, leaving it half-alive with no record of why).
process.on("uncaughtException", (err) => {
  logStatus("ERROR", `Uncaught exception: ${err.stack ?? err.message}`);
});
process.on("unhandledRejection", (reason) => {
  logStatus("ERROR", `Unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

httpServer.listen(PORT, "0.0.0.0", () => {
  logStatus("INFO", `shut-up-and-read listening on :${PORT}`);
});
