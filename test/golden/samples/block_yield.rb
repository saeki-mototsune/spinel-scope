def twice
  yield 1
  yield 2
end

twice do |i|
  puts i * 100
end
