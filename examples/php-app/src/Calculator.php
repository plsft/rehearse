<?php

declare(strict_types=1);

namespace Example\PhpApp;

/**
 * Tiny library for the Rehearse PHP example.
 * The interesting part isn't the code — it's the CI pipeline that runs
 * PHPUnit + PHPStan across PHP 8.2 / 8.3 / 8.4 in parallel.
 */
final class Calculator
{
    public function add(int|float $a, int|float $b): int|float
    {
        return $a + $b;
    }

    public function divide(int|float $a, int|float $b): int|float
    {
        if ($b === 0 || $b === 0.0) {
            throw new \DivisionByZeroError('Cannot divide by zero');
        }
        return $a / $b;
    }

    /**
     * @param array<int, int|float> $values
     */
    public function average(array $values): float
    {
        if (count($values) === 0) {
            throw new \InvalidArgumentException('Cannot average an empty list');
        }
        return array_sum($values) / count($values);
    }
}
