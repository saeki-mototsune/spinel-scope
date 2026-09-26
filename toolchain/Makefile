# spinel scope toolchain — builds web/wasm/spinel.{mjs,wasm}: the whole spinel
# compiler (src/*.c + libprism + the regexp engine it checks literals with) as
# one emscripten module, run in the browser's Worker.
#
# Prereqs: toolchain/spinel-src submodule initialized, patches/ applied and
# `make deps` run in it (vendor/prism). toolchain/emsdk installed, or pass
# EMCC=emcc with emsdk on PATH.
#
#   make                 build web/wasm/
#   make native          build the patched native spinel (bin/spinel + runtime)
#   make golden          compare the wasm compiler with the native one
#   make update-spinel REF=<tag|sha>   bump the submodule (script/update-spinel)
EMCC     ?= emsdk/upstream/emscripten/emcc
SRC       = spinel-src
OUT       = ../web/wasm
OBJ       = build/wasm
PRISM_DIR = $(SRC)/vendor/prism
PRISM_SRCS = $(wildcard $(PRISM_DIR)/src/*.c) $(wildcard $(PRISM_DIR)/src/util/*.c)
# The compiler's own sources: every src/*.c (spinel_parse.c is the library
# copy of the Prism walk, re_lit_check.c the seam to the regexp engine).
SPINEL_SRCS = $(wildcard $(SRC)/src/*.c)
# The regexp engine as upstream's Makefile links it into bin/spinel (RE_SRC).
RE_SRCS   = $(addprefix $(SRC)/lib/regexp/,re_compile.c re_exec.c re_utf8.c unicase.c re_spinel.c)
# Headers upstream's Makefile generates with shell only (no C compiler).
GEN_HDRS  = $(SRC)/build/csrc/spinel_rev.h $(SRC)/build/csrc/sp_rt_names.h

# -DSP_TARGET_INT_BITS=64: the C this wasm32 module emits is built by a 64-bit
# cc on the server (patches/0002).
CFLAGS    = -O2 -Wno-everything -ffp-contract=off -DSP_TARGET_INT_BITS=64
EMFLAGS   = -O2 -sMODULARIZE=1 -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH=1 \
            -sSUPPORT_LONGJMP=1 -sSTACK_SIZE=67108864 -sINVOKE_RUN=0 \
            -sEXIT_RUNTIME=1 -sEXPORTED_RUNTIME_METHODS=callMain,FS,ENV \
            -sENVIRONMENT=web,worker,node
# builtins/*.rb are spliced into programs at compile time; spinel finds them
# beside its binary, which the runner names /spinel/spinel (thisProgram).
EMBED     = --embed-file $(SRC)/builtins@/spinel/builtins

PRISM_OBJS  = $(patsubst $(PRISM_DIR)/src/%.c,$(OBJ)/prism/%.o,$(PRISM_SRCS))
SPINEL_OBJS = $(patsubst $(SRC)/src/%.c,$(OBJ)/src/%.o,$(SPINEL_SRCS))
RE_OBJS     = $(patsubst $(SRC)/lib/regexp/%.c,$(OBJ)/regexp/%.o,$(RE_SRCS))

all: $(OUT)/spinel.mjs

$(OUT)/spinel.mjs: $(SPINEL_OBJS) $(RE_OBJS) $(PRISM_OBJS) $(wildcard $(SRC)/builtins/*.rb)
	@mkdir -p $(OUT)
	$(EMCC) $(EMFLAGS) $(SPINEL_OBJS) $(RE_OBJS) $(PRISM_OBJS) -lm $(EMBED) -o $@

$(OBJ)/prism/%.o: $(PRISM_DIR)/src/%.c
	@mkdir -p $(dir $@)
	$(EMCC) $(CFLAGS) -I$(PRISM_DIR)/include -I$(PRISM_DIR)/src -c $< -o $@

$(OBJ)/src/spinel_parse.o: $(SRC)/src/spinel_parse.c
	@mkdir -p $(dir $@)
	$(EMCC) $(CFLAGS) -I$(PRISM_DIR)/include -c $< -o $@

$(OBJ)/src/re_lit_check.o: $(SRC)/src/re_lit_check.c
	@mkdir -p $(dir $@)
	$(EMCC) $(CFLAGS) -I$(SRC)/lib/regexp -I$(SRC)/lib/regexp/shim -c $< -o $@

$(OBJ)/src/%.o: $(SRC)/src/%.c $(wildcard $(SRC)/src/*.h) $(GEN_HDRS)
	@mkdir -p $(dir $@)
	$(EMCC) $(CFLAGS) -I$(SRC)/src -I$(SRC)/build/csrc -c $< -o $@

$(OBJ)/regexp/%.o: $(SRC)/lib/regexp/%.c
	@mkdir -p $(dir $@)
	$(EMCC) $(CFLAGS) -I$(SRC)/lib/regexp -I$(SRC)/lib/regexp/shim -c $< -o $@

# upstream's own rules (shell only). Made when missing; `make native`
# refreshes them after a bump.
$(GEN_HDRS):
	$(MAKE) -C $(SRC) --no-print-directory $(patsubst $(SRC)/%,%,$(GEN_HDRS))

# The patched native toolchain: bin/spinel (golden expectations) and
# lib/libspinel_rt.a (the host-side compile in `make golden`). Also refreshes
# the generated headers above.
native:
	$(MAKE) -C $(SRC) deps
	$(MAKE) -C $(SRC) bin/spinel lib/libspinel_rt.a

clean:
	rm -rf $(OUT) build

golden: all
	cd .. && test/golden/run.sh

update-spinel:
	cd .. && script/update-spinel $(REF)

.PHONY: all native clean golden update-spinel
