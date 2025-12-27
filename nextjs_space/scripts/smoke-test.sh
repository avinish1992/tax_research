#!/bin/bash
# smoke-test.sh - Quick verification of deployed endpoints
# Usage: ./scripts/smoke-test.sh [base_url]

BASE_URL="${1:-https://taxsavant-ai.netlify.app}"

echo "🔍 Running smoke tests against: $BASE_URL"
echo "================================================"

PASS=0
FAIL=0

# Test function
test_endpoint() {
  local name=$1
  local url=$2
  local expected=$3
  local method=${4:-GET}

  if [ "$method" = "POST" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{}' "$url")
  else
    status=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  fi

  if [ "$status" = "$expected" ]; then
    echo "✅ $name: $status (expected $expected)"
    ((PASS++))
  else
    echo "❌ $name: $status (expected $expected)"
    ((FAIL++))
  fi
}

echo ""
echo "📡 Testing API Routes..."
echo "------------------------"

# API routes should return 401 (unauthorized) not 404 (not found)
test_endpoint "GET /api/documents" "$BASE_URL/api/documents" "401"
test_endpoint "GET /api/chat-sessions" "$BASE_URL/api/chat-sessions" "401"
test_endpoint "POST /api/chat" "$BASE_URL/api/chat" "401" "POST"
test_endpoint "POST /api/feedback" "$BASE_URL/api/feedback" "401" "POST"

echo ""
echo "🌐 Testing Page Routes..."
echo "------------------------"

# Pages should return 200 or redirect (307/302)
test_endpoint "GET / (homepage)" "$BASE_URL" "200"
test_endpoint "GET /login" "$BASE_URL/login" "200"
test_endpoint "GET /signup" "$BASE_URL/signup" "200"

# Dashboard should redirect to login
test_endpoint "GET /dashboard/chat (should redirect)" "$BASE_URL/dashboard/chat" "307"

echo ""
echo "📊 Results"
echo "------------------------"
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo ""

if [ $FAIL -gt 0 ]; then
  echo "⚠️  Some tests failed! Check the output above."
  exit 1
else
  echo "🎉 All tests passed!"
  exit 0
fi
