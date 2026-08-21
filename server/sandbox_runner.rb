require "open3"
require "securerandom"

# Runs one compile+run request in a throwaway spinel-sandbox container and
# parses the length-prefixed section protocol emitted by entry.sh.
module SandboxRunner
  DOCKER_ARGS = %w[
    run --rm -i --network=none --memory=256m --memory-swap=256m --cpus=1
    --pids-limit=64 --read-only --tmpfs /work:rw,exec,size=64m --cap-drop=ALL
    --security-opt=no-new-privileges --user 65534:65534
  ].freeze

  # Hard cap on bytes read from the container's stdout. Without this, a user
  # program can stream unbounded output for its whole timeout budget (e.g. by
  # writing directly to /proc/1/fd/1, bypassing the /work tmpfs entirely) and
  # balloon this process's memory. Sections a bit past the cap are truncated;
  # parse_sections then fails to find a well-formed EXIT line and reports the
  # run as a (cc_exit/run_exit == -1) failure, same shape as any other
  # malformed-protocol response.
  MAX_OUTPUT_BYTES = 16 * 1024 * 1024
  READ_CHUNK_BYTES = 65_536

  # Sandbox image name. Production points this at the SHA-tagged GHCR image
  # so the app and sandbox versions always match (see config/deploy.yml).
  def self.image
    ENV.fetch("SANDBOX_IMAGE", "spinel-sandbox")
  end

  def self.run(c_source, overall_timeout: 15)
    name = "spinel-run-#{SecureRandom.hex(8)}"
    cmd = ["docker", *DOCKER_ARGS, "--name", name, image]
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    out = String.new(encoding: Encoding::BINARY)
    timed_out = false
    overflowed = false
    Open3.popen3(*cmd) do |stdin, stdout, stderr, wait|
      stdin.binmode
      stdout.binmode
      stderr.binmode
      writer = Thread.new do
        stdin.write(c_source)
        stdin.close
      rescue Errno::EPIPE
        nil
      end
      reader = Thread.new do
        while (chunk = stdout.read(READ_CHUNK_BYTES))
          out << chunk
          if out.bytesize > MAX_OUTPUT_BYTES
            overflowed = true
            # Kill immediately rather than waiting out the full
            # overall_timeout — the point of the cap is to bound memory,
            # not just to eventually bound it.
            system("docker", "kill", name, out: File::NULL, err: File::NULL)
            break
          end
        end
      rescue IOError
        nil
      end
      drain = Thread.new do
        stderr.read
      rescue IOError
        nil
      end
      unless wait.join(overall_timeout)
        timed_out = true
        system("docker", "kill", name, out: File::NULL, err: File::NULL)
        wait.join(5)
      end
      [writer, reader, drain].each { |t| t.join(5) }
    end
    duration_ms = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
    # Fold overflow into the same "killed" signal as a hard timeout: both mean
    # we forcibly terminated the container before it finished on its own, so
    # both should surface to the API/UI as timed_out rather than growing the
    # frozen response schema with a new field.
    parse_sections(out, duration_ms, timed_out || overflowed)
  end

  def self.parse_sections(raw, duration_ms, killed)
    # Section lengths and offsets in the wire protocol are byte counts, not
    # character counts. Force ASCII-8BIT so pos/byteslice/regex arithmetic is
    # byte-exact and matching never raises on invalid byte sequences (e.g. raw
    # program output that isn't valid UTF-8). UTF-8 is applied per-section,
    # after slicing, with `scrub` to sanitize.
    raw = raw.b
    sections = {}
    pos = 0
    while (m = raw.match(/\GSECTION (\S+) (\d+)\n/, pos))
      len = m[2].to_i
      body_start = m.end(0)
      sections[m[1]] = raw.byteslice(body_start, len).to_s
      pos = body_start + len
    end
    exit_line = raw.match(/EXIT (-?\d+) (-?\d+)\n\z/, pos)
    cc_exit, run_exit = exit_line ? [exit_line[1].to_i, exit_line[2].to_i] : [-1, -1]
    # in-container `timeout 10` reports 124; treat it as a timeout too.
    # Note: a user program that legitimately exits with status 124 on its own
    # is indistinguishable here from one `timeout` killed — both read as
    # timed_out. Accepted false positive; not worth a second signal for it.
    timed_out = killed || run_exit == 124
    {
      cc_exit: cc_exit,
      cc_stderr: (sections["cc.err"] || "").force_encoding("UTF-8").scrub,
      run_exit: run_exit,
      stdout: (sections["out"] || "").force_encoding("UTF-8").scrub,
      stderr: (sections["err"] || "").force_encoding("UTF-8").scrub,
      duration_ms: duration_ms,
      timed_out: timed_out,
    }
  end
end
