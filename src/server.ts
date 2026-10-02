import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { attachUser, userFromSocketCookie } from "./auth.js";
import { openDb } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { pagesRouter } from "./routes/pages.js";
import { scheduleRouter } from "./routes/schedule.js";
import { registerSocketHandlers, rearmTimers } from "./rooms.js";

const PORT = Number(process.env.PORT ?? 8080);
const DB_PATH = process.env.DB_PATH ?? "./data/app.db";
const README_PATH = process.env.README_PATH ?? "./README.md";

const db = openDb(DB_PATH);

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

io.use((socket, next) => {
  socket.data.user = userFromSocketCookie(db, socket.handshake.headers.cookie);
  next();
});

registerSocketHandlers(io, db);
rearmTimers(io, db);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`shut-up-and-read listening on :${PORT}`);
});
