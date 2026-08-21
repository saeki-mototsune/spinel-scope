words = ["spinel", "compiles", "ruby"]
words.each do |w|
  puts w.upcase
end
puts words.map { |w| w.length }.sum
