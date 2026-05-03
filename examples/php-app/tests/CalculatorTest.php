<?php

declare(strict_types=1);

namespace Example\PhpApp\Tests;

use Example\PhpApp\Calculator;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

final class CalculatorTest extends TestCase
{
    private Calculator $calc;

    protected function setUp(): void
    {
        $this->calc = new Calculator();
    }

    #[Test]
    public function addsIntegers(): void
    {
        $this->assertSame(5, $this->calc->add(2, 3));
    }

    #[Test]
    public function addsFloats(): void
    {
        $this->assertEqualsWithDelta(0.3, $this->calc->add(0.1, 0.2), 0.0001);
    }

    #[Test]
    public function dividesNumbers(): void
    {
        $this->assertSame(5.0, $this->calc->divide(10, 2));
    }

    #[Test]
    public function divisionByZeroThrows(): void
    {
        $this->expectException(\DivisionByZeroError::class);
        $this->calc->divide(1, 0);
    }

    #[Test]
    public function averagesNumbers(): void
    {
        $this->assertSame(3.0, $this->calc->average([1, 2, 3, 4, 5]));
    }

    #[Test]
    public function emptyAverageThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->calc->average([]);
    }
}
