require_relative "test_helper"
require_relative "../sandbox_runner"

class SandboxRunnerTest < Minitest::Test
  FIB_C = File.read(File.join(ROOT, "test/golden/expected/fib/out.c"))
  FIB_OUT = File.read(File.join(ROOT, "test/golden/expected/fib/run.txt"))

  def test_compiles_and_runs_fib
    r = SandboxRunner.run(FIB_C)
    assert_equal 0, r[:cc_exit]
    assert_equal "", r[:cc_stderr]
    assert_equal 0, r[:run_exit]
    assert_equal FIB_OUT, r[:stdout]
    assert_equal "", r[:stderr]
    assert_equal false, r[:timed_out]
    assert_kind_of Integer, r[:duration_ms]
  end

  def test_reports_compile_error
    r = SandboxRunner.run("int main(void){")
    refute_equal 0, r[:cc_exit]
    assert_includes r[:cc_stderr], "error"
    assert_equal(-1, r[:run_exit])
  end

  # Regression test: a multibyte compiler diagnostic in the cc.err section
  # used to desynchronize byte-offset parsing (String#match's `pos` argument
  # is a character offset on UTF-8-tagged strings, but the wire protocol's
  # SECTION lengths are byte counts), silently dropping the stdout section
  # that follows it.
  def test_stdout_survives_multibyte_compiler_diagnostic
    c = <<~'C'
      #include <stdio.h>
      #warning "日本語の警告"
      int main(void) {
        printf("ok\n");
        return 0;
      }
    C
    r = SandboxRunner.run(c)
    assert_equal 0, r[:cc_exit]
    assert_includes r[:cc_stderr], "日本語の警告"
    assert_equal "ok\n", r[:stdout]
  end

  # Regression test: invalid UTF-8 bytes in the program's own stdout used to
  # raise ArgumentError out of String#match, escaping SandboxRunner.run
  # entirely (and bypassing app.rb's halt 500 JSON error path).
  def test_stdout_scrubs_invalid_utf8_bytes
    c = <<~'C'
      int main(void) {
        putchar(0xff);
        putchar(0xfe);
        putchar('\n');
        return 0;
      }
    C
    r = SandboxRunner.run(c)
    assert_equal 0, r[:run_exit]
    assert r[:stdout].valid_encoding?
    refute_empty r[:stdout]
  end

  INFINITE_C = <<~C
    int main(void) { for (;;) {} return 0; }
  C

  def test_kills_infinite_loop
    r = SandboxRunner.run(INFINITE_C)
    assert_equal 0, r[:cc_exit]
    assert_equal true, r[:timed_out]
    assert_equal 124, r[:run_exit]
  end

  HUGE_OUTPUT_C = <<~C
    #include <stdio.h>
    int main(void) {
      for (long i = 0; i < 20L * 1024 * 1024; i++) putchar('x');
      return 0;
    }
  C

  # Regression test for the memory-DoS guard: a program that floods stdout
  # (well past MAX_OUTPUT_BYTES) must not make the reader thread buffer the
  # whole stream. Bound the *result*, not the server's own RSS (a real
  # ballooning bug wouldn't reliably OOM in a fast-running test either way).
  def test_caps_stdout_and_reports_a_bounded_failure
    r = SandboxRunner.run(HUGE_OUTPUT_C)
    total = r[:stdout].bytesize + r[:cc_stderr].bytesize + r[:stderr].bytesize
    assert_operator total, :<=, SandboxRunner::MAX_OUTPUT_BYTES + SandboxRunner::READ_CHUNK_BYTES,
      "capped read must not let output balloon past cap + one chunk"
    assert_equal true, r[:timed_out]
  end

  def test_image_defaults_to_local_tag
    assert_equal "spinel-sandbox", SandboxRunner.image
  end

  def test_image_env_override
    ENV["SANDBOX_IMAGE"] = "ghcr.io/example/spinel-sandbox:abc123"
    assert_equal "ghcr.io/example/spinel-sandbox:abc123", SandboxRunner.image
  ensure
    ENV.delete("SANDBOX_IMAGE")
  end
end
