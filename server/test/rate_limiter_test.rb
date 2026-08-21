require_relative "test_helper"
require_relative "../rate_limiter"

class RateLimiterTest < Minitest::Test
  OK_APP = ->(_env) { [200, { "content-type" => "text/plain" }, ["ok"]] }

  def env_for(path: "/api/compile_run", remote_addr: "10.0.0.1", xff: nil)
    env = { "PATH_INFO" => path, "REMOTE_ADDR" => remote_addr }
    env["HTTP_X_FORWARDED_FOR"] = xff if xff
    env
  end

  def test_limits_by_remote_addr_by_default
    rl = RateLimiter.new(OK_APP, limit: 2, window: 60)
    assert_equal 200, rl.call(env_for)[0]
    assert_equal 200, rl.call(env_for)[0]
    assert_equal 429, rl.call(env_for)[0]
  end

  def test_ignores_xff_without_trust_proxy
    rl = RateLimiter.new(OK_APP, limit: 1, window: 60)
    assert_equal 200, rl.call(env_for(xff: "1.1.1.1"))[0]
    # Same REMOTE_ADDR, different XFF: must share the bucket — XFF is
    # untrusted without a proxy in front.
    assert_equal 429, rl.call(env_for(xff: "2.2.2.2"))[0]
  end

  def test_trust_proxy_buckets_by_last_xff_entry
    rl = RateLimiter.new(OK_APP, limit: 1, window: 60, trust_proxy: true)
    assert_equal 200, rl.call(env_for(xff: "1.1.1.1"))[0]
    # Different proxy-appended client IP → separate bucket.
    assert_equal 200, rl.call(env_for(xff: "2.2.2.2"))[0]
    assert_equal 429, rl.call(env_for(xff: "1.1.1.1"))[0]
  end

  def test_trust_proxy_uses_last_entry_not_spoofable_prefix
    rl = RateLimiter.new(OK_APP, limit: 1, window: 60, trust_proxy: true)
    assert_equal 200, rl.call(env_for(xff: "9.9.9.9, 1.1.1.1"))[0]
    # Spoofed prefix differs but the proxy-appended last hop is identical →
    # same bucket. Attacker can't mint fresh buckets via forged XFF.
    assert_equal 429, rl.call(env_for(xff: "8.8.8.8, 1.1.1.1"))[0]
  end

  def test_trust_proxy_falls_back_to_remote_addr_without_header
    rl = RateLimiter.new(OK_APP, limit: 1, window: 60, trust_proxy: true)
    assert_equal 200, rl.call(env_for)[0]
    assert_equal 429, rl.call(env_for)[0]
  end

  def test_non_api_paths_bypass_limiter
    rl = RateLimiter.new(OK_APP, limit: 1, window: 60)
    3.times { assert_equal 200, rl.call(env_for(path: "/"))[0] }
  end

  def test_trust_proxy_survives_comma_only_header
    rl = RateLimiter.new(OK_APP, limit: 1, window: 60, trust_proxy: true)
    assert_equal 200, rl.call(env_for(xff: ","))[0]
    # Falls back to REMOTE_ADDR bucketing — same source, same bucket.
    assert_equal 429, rl.call(env_for(xff: ","))[0]
  end

  def test_trust_proxy_ignores_trailing_empty_entry
    rl = RateLimiter.new(OK_APP, limit: 1, window: 60, trust_proxy: true)
    assert_equal 200, rl.call(env_for(xff: "1.1.1.1, "))[0]
    assert_equal 429, rl.call(env_for(xff: "1.1.1.1,"))[0]
  end
end
