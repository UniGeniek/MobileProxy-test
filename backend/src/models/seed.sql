-- ============================================
-- DataCenter — Seed Data
-- ============================================

-- 1. Tariffs
INSERT INTO tariffs (id, name, price_per_hour, max_proxies, reset_cooldown, conn_limit)
VALUES 
(1, 'Trial', 0.0500, 2, 120, 3),
(2, 'Starter', 0.0500, 5, 60, 5),
(3, 'Growth', 0.0400, 25, 45, 8),
(4, 'Scale', 0.0300, 100, 30, 10)
ON CONFLICT (name) DO NOTHING;
SELECT setval('tariffs_id_seq', (SELECT MAX(id) FROM tariffs));

-- 2. Default Admin (Password: admin123)
-- Hash for 'admin123'
INSERT INTO users (username, email, password_hash, role, balance, tariff_id, account_status)
VALUES ('admin', 'admin@datacenter.com', '$2b$10$vI8A7WqH8l38N264h.L5r.Wf.t6Wp1S.m8pQvL8.y7P1K3eW8.K.y', 'admin', 100.00, 4, 'active')
ON CONFLICT (username) DO NOTHING;

-- 3. Default Operators & Users
INSERT INTO users (username, email, password_hash, role, balance, tariff_id, account_status)
VALUES ('operator1', 'op1@datacenter.com', '$2b$10$vI8A7WqH8l38N264h.L5r.Wf.t6Wp1S.m8pQvL8.y7P1K3eW8.K.y', 'operator', 0, 2, 'active')
ON CONFLICT (username) DO NOTHING;

-- 3. Proxy Groups
INSERT INTO proxy_groups (name, description)
VALUES 
('Moscow_LTE', 'LTE Routers in Moscow Region'),
('SPB_5G', '5G Routers in Saint Petersburg')
ON CONFLICT (name) DO NOTHING;

-- 4. Proxies (Examples for different types)
-- You can expand this list to 50 ports
INSERT INTO proxies (port, group_id, router_ip, router_type, router_ssh_user, router_ssh_key)
VALUES 
(3001, 1, '192.168.1.1', 'openwrt', 'root', NULL),
(3002, 1, '192.168.8.1', 'huawei', 'admin', NULL),
(3003, 2, '10.0.0.1', 'mikrotik', 'admin', NULL),
(3004, 2, '192.168.0.1', 'zte', 'admin', NULL)
ON CONFLICT (port) DO NOTHING;

-- Link admin to all proxies for testing
INSERT INTO user_proxies (user_id, proxy_id)
SELECT u.id, p.id FROM users u, proxies p WHERE u.username = 'admin'
ON CONFLICT DO NOTHING;
