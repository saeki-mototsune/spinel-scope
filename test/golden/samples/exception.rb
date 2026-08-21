def risky(n)
  raise "boom" if n > 2
  n * 10
end

begin
  puts risky(1)
  puts risky(5)
rescue => e
  puts "rescued: #{e.message}"
end
puts "after"
