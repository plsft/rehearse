using MyApp;
using Xunit;

namespace MyApp.Tests;

public sealed class CalculatorTests
{
    private readonly Calculator _calc = new();

    [Fact]
    public void Adds_Integers()
    {
        Assert.Equal(5, _calc.Add(2, 3));
    }

    [Fact]
    public void Adds_Negatives()
    {
        Assert.Equal(0, _calc.Add(-1, 1));
    }

    [Fact]
    public void Divides_Numbers()
    {
        Assert.Equal(5.0, _calc.Divide(10, 2));
    }

    [Fact]
    public void Divides_By_Zero_Throws()
    {
        Assert.Throws<DivideByZeroException>(() => _calc.Divide(1, 0));
    }

    [Theory]
    [InlineData(new double[] { 1, 2, 3, 4, 5 }, 3.0)]
    [InlineData(new double[] { 10, 20 }, 15.0)]
    [InlineData(new double[] { -1, 1 }, 0.0)]
    public void Averages_Numbers(double[] values, double expected)
    {
        Assert.Equal(expected, _calc.Average(values));
    }

    [Fact]
    public void Empty_Average_Throws()
    {
        Assert.Throws<ArgumentException>(() => _calc.Average(Array.Empty<double>()));
    }
}
