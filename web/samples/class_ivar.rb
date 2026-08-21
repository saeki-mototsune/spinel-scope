class Counter
  def initialize(start)
    @count = start
  end

  def increment
    @count += 1
  end

  def count
    @count
  end
end

c = Counter.new(10)
3.times { c.increment }
puts c.count
