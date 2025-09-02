#!/usr/bin/env bash

# Track test results
PASSED_TESTS=()
FAILED_TESTS=()
TOTAL_TESTS=0

echo "🧪 Running Community Notes Integration Tests"
echo "============================================="

for test_file in *.sh; do
	if [ -f "$test_file" ] && [ "$test_file" != "run-tests.sh" ] && [ "$test_file" != "test-utils.sh" ]; then
		TOTAL_TESTS=$((TOTAL_TESTS + 1))
		test_name=$(basename "$test_file")
		echo ""
		echo "Running $test_name..."

		if bash "$test_file"; then
			PASSED_TESTS+=("$test_name")
			echo "✅ $test_name - PASSED"
		else
			FAILED_TESTS+=("$test_name")
			echo "❌ $test_name - FAILED"
		fi
	fi
done

# Print summary
echo ""
echo "📊 Test Summary"
echo "==============="
echo "Total tests: $TOTAL_TESTS"
echo "Passed: ${#PASSED_TESTS[@]}"
echo "Failed: ${#FAILED_TESTS[@]}"
echo ""

# Print detailed results
if [ ${#PASSED_TESTS[@]} -gt 0 ]; then
	echo "✅ Passed tests:"
	for test in "${PASSED_TESTS[@]}"; do
		echo "  ✓ $test"
	done
	echo ""
fi

if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
	echo "❌ Failed tests:"
	for test in "${FAILED_TESTS[@]}"; do
		echo "  ✗ $test"
	done
	echo ""
fi

# Final status
if [ ${#FAILED_TESTS[@]} -eq 0 ]; then
	echo "🎉 All Integration Tests Passed!"
	exit 0
else
	echo "💥 ${#FAILED_TESTS[@]} test(s) failed"
	exit 1
fi
