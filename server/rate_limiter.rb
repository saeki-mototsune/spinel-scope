# Minimal per-IP sliding-window rate limiter for /api/ paths.
# In-process only — suitable for a single-Puma-worker deployment.
class RateLimiter
  def initialize(app, limit: 10, window: 60, trust_proxy: false)
    @app = app
    @limit = limit
    @window = window
    @trust_proxy = trust_proxy
    @hits = Hash.new { |h, k| h[k] = [] }
    @mutex = Mutex.new
  end

  def call(env)
    return @app.call(env) unless env["PATH_INFO"].start_with?("/api/")
    ip = client_ip(env)
    now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    allowed = @mutex.synchronize do
      hits = @hits[ip]
      hits.reject! { |t| now - t > @window }
      if hits.size >= @limit
        false
      else
        hits << now
        true
      end
    end
    return [429, { "content-type" => "application/json" }, ['{"error":"rate limited"}']] unless allowed
    @app.call(env)
  end

  private

  # Behind kamal-proxy every request's REMOTE_ADDR is the proxy itself, so
  # trust_proxy mode reads the client from X-Forwarded-For instead. Only the
  # *last* entry is used: kamal-proxy appends it, so unlike the rest of the
  # header the client cannot forge it.
  def client_ip(env)
    if @trust_proxy && (xff = env["HTTP_X_FORWARDED_FOR"])
      last = xff.split(",").map(&:strip).reject(&:empty?).last
      return last if last
    end
    env["REMOTE_ADDR"] || "unknown"
  end
end
