-- Kira Studio — Redis seed data (idempotent)
-- Run: docker exec -i kira-redis redis-cli EVAL "$(cat scripts/redis/seed.lua)" 0
-- ~25k keys of each Redis data type.

redis.call('FLUSHDB')

local N = 25000
local tiers = {'bronze', 'silver', 'gold', 'platinum'}
local statuses = {'active', 'suspended', 'deleted'}

-- 20,000 hashes ("user:<id>") — one hash per row
for i = 1, N do
  redis.call('HSET', 'user:' .. i,
    'email', 'user' .. i .. '@example.com',
    'name', 'Customer ' .. i,
    'tier', tiers[(i % 4) + 1],
    'status', statuses[(i % 3) + 1],
    'balance', tostring(math.random(0, 100000) / 100),
    'loyalty_points', tostring(math.random(0, 10000)),
    'active', i % 7 ~= 0 and '1' or '0',
    'created_at', tostring(1600000000 + math.random(0, 300000000)))
  if i % 10 == 0 then
    redis.call('EXPIRE', 'user:' .. i, 86400)
  end
end

-- 20,000 strings ("session:<id>")
for i = 1, N do
  redis.call('SET', 'session:' .. i, 'token-' .. i)
  if i % 5 == 0 then
    redis.call('EXPIRE', 'session:' .. i, 3600)
  end
end

-- 20,000 members in a sorted set (leaderboard)
for i = 1, N do
  redis.call('ZADD', 'leaderboard', i * 1.5, 'member:' .. i)
end

-- 20,000 members in a set (active users)
for i = 1, N do
  redis.call('SADD', 'active:users', i)
end

-- 20,000 elements in a list (recent events)
for i = 1, N do
  redis.call('LPUSH', 'recent:events', 'event-' .. i)
end

-- 20,000 entries in a stream (events)
for i = 1, N do
  redis.call('XADD', 'events', '*',
    'id', tostring(i),
    'type', 'click',
    'user', tostring((i % N) + 1))
end

redis.call('LTRIM', 'recent:events', 0, N - 1)

return {
  hashes = redis.call('DBSIZE'),
  leaderboard = redis.call('ZCARD', 'leaderboard'),
  active_users = redis.call('SCARD', 'active:users'),
  recent_events = redis.call('LLEN', 'recent:events'),
  events_stream = redis.call('XLEN', 'events'),
}
