-- Better Auth (better-auth 1.7.7 + anonymous plugin)
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "isAnonymous" integer);
create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");

-- The board registry. Contents live in each board's Durable Object.
-- owner_id deliberately has no foreign key: when an anonymous user links Google,
-- Better Auth deletes the anonymous user *after* onLinkAccount re-owns these rows.
create table boards (
  id text primary key,
  owner_id text not null,
  title text not null,
  created_at integer not null,
  opened_at integer not null,
  preview_nodes integer,
  preview_media integer,
  preview_saved_at integer
);
create index boards_owner on boards(owner_id);

-- Who may read an R2 object at assets/{id}.
create table assets (
  id text primary key,
  owner_id text not null,
  type text not null,
  size integer not null
);
create index assets_owner on assets(owner_id);
