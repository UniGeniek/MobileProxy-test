-- ============================================
-- DataCenter — Database Schema
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users ──
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(64) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    phone           VARCHAR(32),
    password_hash   VARCHAR(255) NOT NULL,
    proxy_password  VARCHAR(64), -- H-02: Secure proxy password
    role            VARCHAR(16) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'operator')),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    daily_reset_count INTEGER NOT NULL DEFAULT 0,
    daily_reset_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- Billing
    balance         DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
    last_charged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    account_status  VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'grace', 'suspended')),
    is_trial        BOOLEAN NOT NULL DEFAULT false,
    tariff_id       INTEGER, -- Added FK below
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Tariffs ──
CREATE TABLE tariffs (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(64) UNIQUE NOT NULL,
    price_per_hour  DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
    max_proxies     INTEGER NOT NULL DEFAULT 1,
    reset_cooldown  INTEGER NOT NULL DEFAULT 60,
    conn_limit      INTEGER NOT NULL DEFAULT 5,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD CONSTRAINT fk_user_tariff FOREIGN KEY (tariff_id) REFERENCES tariffs(id) ON DELETE SET NULL;

-- ── Proxy Groups ──
CREATE TABLE proxy_groups (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(64) UNIQUE NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Proxies ──
CREATE TABLE proxies (
    id              SERIAL PRIMARY KEY,
    port            INTEGER UNIQUE NOT NULL,
    group_id        INTEGER REFERENCES proxy_groups(id) ON DELETE SET NULL,
    router_ip       VARCHAR(45) NOT NULL,
    router_ssh_port INTEGER NOT NULL DEFAULT 22,
    router_ssh_user VARCHAR(64) NOT NULL DEFAULT 'root',
    router_ssh_key  TEXT,                                    -- SSH private key (encrypted)
    router_type     VARCHAR(32) NOT NULL DEFAULT 'openwrt'
                    CHECK (router_type IN ('openwrt', 'huawei', 'mikrotik', 'zte', 'custom')),
    current_ip      VARCHAR(45),
    status          VARCHAR(16) NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle', 'online', 'offline', 'resetting', 'checking', 'error', 'cooldown', 'no_ip_change')),
    last_reset      TIMESTAMPTZ,
    last_ip_change  TIMESTAMPTZ,
    last_health_check TIMESTAMPTZ,
    offline_since   TIMESTAMPTZ,
    connections     INTEGER NOT NULL DEFAULT 0,
    error_message   TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── User ↔ Proxy access ──
CREATE TABLE user_proxies (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proxy_id        INTEGER NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, proxy_id)
);

-- ── Reset Logs ──
CREATE TABLE reset_logs (
    id              SERIAL PRIMARY KEY,
    proxy_id        INTEGER NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
    triggered_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    old_ip          VARCHAR(45),
    new_ip          VARCHAR(45),
    status          VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'success', 'failed', 'ip_unchanged')),
    error_message   TEXT,
    duration_ms     INTEGER,
    client_source_ip VARCHAR(45),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Reset Jobs (state machine) ──
CREATE TABLE reset_jobs (
    id              SERIAL PRIMARY KEY,
    reset_log_id    INTEGER REFERENCES reset_logs(id) ON DELETE CASCADE,
    proxy_id        INTEGER NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
    port            INTEGER NOT NULL,
    requested_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    state           VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','routed','queued','running','success','failed','dead_letter')),
    assigned_agent_id INTEGER REFERENCES node_agents(id) ON DELETE SET NULL,
    queue_job_id    VARCHAR(255),
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reset_jobs_state ON reset_jobs(state);
CREATE INDEX idx_reset_jobs_proxy ON reset_jobs(proxy_id);

CREATE TRIGGER trg_reset_jobs_updated_at
    BEFORE UPDATE ON reset_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Access Logs (aggregated per session) ──
CREATE TABLE access_logs (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    proxy_id        INTEGER NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
    session_id      UUID DEFAULT uuid_generate_v4(),
    client_source_ip VARCHAR(45),
    action          VARCHAR(32) NOT NULL CHECK (action IN ('connect', 'disconnect', 'auth_success', 'auth_failure', 'reset_ip')),
    bytes_in        BIGINT DEFAULT 0,
    bytes_out       BIGINT DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Audit Logs (admin actions) ──
CREATE TABLE audit_logs (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(128) NOT NULL,
    details         JSONB,
    ip_address      VARCHAR(45),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Refresh Tokens ──
CREATE TABLE refresh_tokens (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Proxy IP History ──
CREATE TABLE proxy_ip_history (
    id              SERIAL PRIMARY KEY,
    proxy_id        INTEGER NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
    ip_address      VARCHAR(45) NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Billing Logs ──
CREATE TABLE billing_logs (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(16) NOT NULL CHECK (type IN ('charge', 'topup', 'bonus')),
    amount          DECIMAL(12,4) NOT NULL,
    balance_before  DECIMAL(12,4) NOT NULL,
    balance_after   DECIMAL(12,4) NOT NULL,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Usage Ledger (Single Source of Truth) ──
CREATE TABLE usage_ledger (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proxy_id        INTEGER NOT NULL REFERENCES proxies(id) ON DELETE CASCADE,
    bytes_in        BIGINT DEFAULT 0,
    bytes_out       BIGINT DEFAULT 0,
    duration        INTEGER DEFAULT 0, -- seconds
    cost            DECIMAL(12,4) DEFAULT 0,
    source          VARCHAR(32) DEFAULT 'proxy_log', -- 'proxy_log', 'api', 'heartbeat'
    event_hash      VARCHAR(64) UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_proxies_port ON proxies(port);
CREATE INDEX idx_proxies_status ON proxies(status);
CREATE INDEX idx_proxies_group ON proxies(group_id);
CREATE INDEX idx_proxies_active ON proxies(is_active);
CREATE INDEX idx_user_proxies_user ON user_proxies(user_id);
CREATE INDEX idx_user_proxies_proxy ON user_proxies(proxy_id);
CREATE INDEX idx_reset_logs_proxy ON reset_logs(proxy_id);
CREATE INDEX idx_reset_logs_created ON reset_logs(created_at);
CREATE INDEX idx_reset_logs_user ON reset_logs(triggered_by);
CREATE INDEX idx_access_logs_user ON access_logs(user_id);
CREATE INDEX idx_access_logs_proxy ON access_logs(proxy_id);
CREATE INDEX idx_access_logs_created ON access_logs(created_at);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- ── Updated_at trigger ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_proxies_updated_at
    BEFORE UPDATE ON proxies FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Node Agents (edge executors) ──
CREATE TABLE node_agents (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(128) NOT NULL,
    host            VARCHAR(255),
    region          VARCHAR(64),
    agent_token_hash VARCHAR(255),
    status          VARCHAR(16) NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'degraded')),
    last_heartbeat  TIMESTAMPTZ,
    capabilities    JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_node_agents_status ON node_agents(status);
CREATE INDEX idx_node_agents_heartbeat ON node_agents(last_heartbeat);

CREATE TRIGGER trg_node_agents_updated_at
    BEFORE UPDATE ON node_agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Auto-cleanup: reset daily counters ──
CREATE OR REPLACE FUNCTION reset_daily_counters()
RETURNS void AS $$
BEGIN
    UPDATE users SET daily_reset_count = 0, daily_reset_date = CURRENT_DATE
    WHERE daily_reset_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;
