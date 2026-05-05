namespace MyApp;

/// <summary>
/// Tiny library for the Rehearse dotnet-app example.
/// The interesting part is the CI pipeline that targets net8.0 + net9.0 + net10.0
/// in parallel via the runner's matrix scheduler.
/// </summary>
public sealed class Calculator
{
    /// <summary>Adds two numbers.</summary>
    public double Add(double a, double b) => a + b;

    /// <summary>Divides a by b. Throws on division by zero.</summary>
    public double Divide(double a, double b)
    {
        if (b == 0) throw new DivideByZeroException("Cannot divide by zero");
        return a / b;
    }

    /// <summary>Returns the arithmetic mean of values. Throws on empty input.</summary>
    public double Average(IReadOnlyCollection<double> values)
    {
        if (values.Count == 0) throw new ArgumentException("Cannot average an empty list", nameof(values));
        return values.Sum() / values.Count;
    }
}
