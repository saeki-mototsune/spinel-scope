# Literals past 32 bits: the in-browser (wasm32) compiler must still emit C
# for the 64-bit server (patches/0002).
big = 3_000_000_000
puts big * 2
puts 2**40 + 1
