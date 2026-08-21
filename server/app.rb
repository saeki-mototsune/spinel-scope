require "sinatra/base"
require "json"
require_relative "sandbox_runner"

module SpinelScope
  class App < Sinatra::Base
    MAX_C_SOURCE_BYTES = 1_000_000

    set :public_folder, File.expand_path("../web", __dir__)
    set :static, true

    get "/" do
      send_file File.join(settings.public_folder, "index.html")
    end

    # kamal-proxy healthcheck: the new container only receives traffic once
    # this returns 200.
    get "/up" do
      "OK"
    end

    post "/api/compile_run" do
      content_type :json
      raw = request.body.read
      halt 413, { error: "payload too large" }.to_json if raw.bytesize > MAX_C_SOURCE_BYTES + 1024
      begin
        payload = JSON.parse(raw)
      rescue JSON::ParserError
        halt 400, { error: "invalid JSON" }.to_json
      end
      halt 400, { error: "c_source is required" }.to_json unless payload.is_a?(Hash)
      source = payload["c_source"]
      halt 400, { error: "c_source is required" }.to_json unless source.is_a?(String) && !source.empty?
      halt 413, { error: "c_source too large" }.to_json if source.bytesize > MAX_C_SOURCE_BYTES
      result = SandboxRunner.run(source)
      halt 500, { error: "sandbox failure" }.to_json if result[:cc_exit] == -1 && result[:cc_stderr].empty? && !result[:timed_out]
      result.to_json
    end
  end
end
