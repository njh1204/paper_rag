import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const vaultState = sqliteTable("vault_state", {
  id: integer("id").primaryKey(),
  generation: integer("generation").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const vaultFiles = sqliteTable(
  "vault_files",
  {
    generation: integer("generation").notNull(),
    path: text("path").notNull(),
    hash: text("hash").notNull(),
    size: integer("size").notNull(),
    mime: text("mime").notNull(),
    mtime: integer("mtime").notNull(),
    searchText: text("search_text").notNull().default(""),
    listed: integer("listed", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [primaryKey({ columns: [table.generation, table.path] })],
);

export const vaultProfiles = sqliteTable("vault_profiles", {
  generation: integer("generation").primaryKey(),
  json: text("json").notNull(),
});

export const authState = sqliteTable("auth_state", {
  id: integer("id").primaryKey(),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  iterations: integer("iterations").notNull(),
  sessionEpoch: integer("session_epoch").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

export const loginAttempts = sqliteTable("login_attempts", {
  fingerprint: text("fingerprint").primaryKey(),
  windowStartedAt: integer("window_started_at").notNull(),
  failures: integer("failures").notNull(),
  blockedUntil: integer("blocked_until").notNull().default(0),
});

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const syncNonces = sqliteTable("sync_nonces", {
  nonce: text("nonce").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const blobObjects = sqliteTable("blob_objects", {
  hash: text("hash").primaryKey(),
  size: integer("size").notNull(),
  mime: text("mime").notNull(),
  createdAt: integer("created_at").notNull(),
});
