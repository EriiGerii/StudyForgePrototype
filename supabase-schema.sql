-- Create users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index on email for faster lookups
CREATE INDEX idx_users_email ON users(email);

-- Create sessions table
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  userId UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index on userId for faster lookups
CREATE INDEX idx_sessions_userId ON sessions(userId);

-- Create histories table
CREATE TABLE histories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT,
  summary JSONB,
  quiz JSONB,
  simulation JSONB,
  escape JSONB,
  experts JSONB,
  memory JSONB,
  mini_games JSONB,
  sourceSentences JSONB,
  sourceText TEXT,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index on userId for faster lookups
CREATE INDEX idx_histories_userId ON histories(userId);

-- Create index on createdAt for sorting
CREATE INDEX idx_histories_createdAt ON histories(createdAt DESC);
