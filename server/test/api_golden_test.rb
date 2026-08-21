require_relative "test_helper"
require "rack/test"
require_relative "../app"

# Full-pipeline server check: every golden sample's generated C must run
# through the real sandbox and reproduce the committed run.txt exactly.
class ApiGoldenTest < Minitest::Test
  include Rack::Test::Methods

  def app = SpinelVisualize::App

  def setup
    header "HOST", "localhost"
  end

  Dir.glob(File.join(ROOT, "test/golden/expected/*")).sort.each do |dir|
    name = File.basename(dir)
    define_method("test_golden_#{name}") do
      # Force UTF-8 rather than relying on Encoding.default_external (which
      # tracks the process locale and is US-ASCII in some environments,
      # e.g. CI containers with no LANG set): out.c/run.txt for the
      # nihongo sample carry literal UTF-8 bytes, so an ASCII-tagged read
      # breaks Hash#to_json (JSON::GeneratorError) and would break the
      # run.txt comparison below the same way sandbox_runner.rb already
      # guards against for subprocess output.
      post "/api/compile_run",
           { c_source: File.read(File.join(dir, "out.c"), encoding: "UTF-8") }.to_json,
           "CONTENT_TYPE" => "application/json"
      assert_equal 200, last_response.status
      body = JSON.parse(last_response.body)
      assert_equal 0, body["cc_exit"], "cc_stderr: #{body['cc_stderr']}"
      assert_equal 0, body["run_exit"]
      assert_equal File.read(File.join(dir, "run.txt"), encoding: "UTF-8"), body["stdout"]
    end
  end
end
