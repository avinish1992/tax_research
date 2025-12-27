#!/bin/bash
# verify-deploy.sh - Verifies that Netlify deployment is healthy
# Usage: ./scripts/verify-deploy.sh

set -e

SITE_URL="https://taxsavant-ai.netlify.app"
MAX_RETRIES=5
RETRY_DELAY=10

echo "🔍 Verifying deployment at $SITE_URL..."
echo ""

# Function to check endpoint
check_endpoint() {
    local endpoint=$1
    local expected_status=$2
    local description=$3

    status=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL$endpoint" 2>/dev/null)

    if [[ "$status" == "$expected_status" ]]; then
        echo "✅ $description: $status"
        return 0
    else
        echo "❌ $description: Expected $expected_status, got $status"
        return 1
    fi
}

# Wait for deployment to propagate
echo "⏳ Waiting for deployment to propagate..."
sleep 5

# Check various endpoints
echo ""
echo "📡 Checking endpoints..."

FAILED=0

# Homepage should return 200
check_endpoint "/" "200" "Homepage" || FAILED=1

# API without auth should return 401
check_endpoint "/api/documents" "401" "API route (documents)" || FAILED=1

# Login page should return 200
check_endpoint "/login" "200" "Login page" || FAILED=1

# Dashboard without auth should redirect (302 or 307)
status=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/dashboard/chat" 2>/dev/null)
if [[ "$status" == "302" || "$status" == "307" || "$status" == "200" ]]; then
    echo "✅ Dashboard route: $status"
else
    echo "❌ Dashboard route: Unexpected status $status"
    FAILED=1
fi

echo ""

# Final result
if [[ $FAILED -eq 0 ]]; then
    echo "🎉 All checks passed! Deployment is healthy."
    exit 0
else
    echo "⚠️  Some checks failed. Please investigate."
    exit 1
fi
