require_relative "test_helper"
require "rack/test"
require_relative "../app"
require_relative "../rate_limiter"

class ApiTest < Minitest::Test
  include Rack::Test::Methods

  def app = SpinelScope::App

  FIB_C = File.read(File.join(ROOT, "test/golden/expected/fib/out.c"))
  FIB_OUT = File.read(File.join(ROOT, "test/golden/expected/fib/run.txt"))

  # Sinatra 4.x enables Rack::Protection::HostAuthorization by default, which
  # in development mode permits localhost/IP hosts but not Rack::Test's fake
  # default host ("example.org"). Use an explicitly-permitted host so tests
  # exercise real app behavior instead of getting rejected at that layer.
  def setup
    header "HOST", "localhost"
  end

  def post_c(source)
    post "/api/compile_run", { c_source: source }.to_json,
         "CONTENT_TYPE" => "application/json"
  end

  def test_compile_run_happy_path
    post_c FIB_C
    assert_equal 200, last_response.status
    body = JSON.parse(last_response.body)
    assert_equal 0, body["cc_exit"]
    assert_equal FIB_OUT, body["stdout"]
    assert_equal false, body["timed_out"]
  end

  def test_serves_index_html
    get "/"
    assert_equal 200, last_response.status
    assert_includes last_response.body, "spinel"
  end

  def test_up_healthcheck
    get "/up"
    assert_equal 200, last_response.status
  end

  def test_rate_limit_returns_429
    limiter = RateLimiter.new(SpinelScope::App, limit: 2, window: 60)
    session = Rack::Test::Session.new(limiter)
    session.header "HOST", "localhost"
    3.times do |i|
      session.post "/api/compile_run", { c_source: "x" }.to_json,
                   "CONTENT_TYPE" => "application/json"
    end
    assert_equal 429, session.last_response.status
  end

  def test_payload_too_large_returns_413
    post_c "int main(void){return 0;}" + (" " * 1_000_001)
    assert_equal 413, last_response.status
  end

  def test_invalid_json_returns_400
    post "/api/compile_run", "not json", "CONTENT_TYPE" => "application/json"
    assert_equal 400, last_response.status
  end

  def test_non_object_json_returns_400
    post "/api/compile_run", "[1,2]", "CONTENT_TYPE" => "application/json"
    assert_equal 400, last_response.status
  end
end
