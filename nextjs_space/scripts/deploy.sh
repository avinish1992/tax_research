#!/bin/bash
# deploy.sh - Ensures proper deployment to Netlify
# Usage: ./scripts/deploy.sh [commit message]

set -e

COMMIT_MSG="${1:-"Deploy to production"}"

echo "🔍 Running pre-deployment checks..."

# Check if there are uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
    echo "📝 Uncommitted changes detected. Staging all changes..."
    git add -A
    git commit -m "$COMMIT_MSG

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
fi

echo "🚀 Pushing to origin to trigger Netlify build..."
git push origin main

echo "✅ Deployment triggered! Monitor at: https://app.netlify.com/projects/taxsavant-ai/deploys"
echo ""
echo "Note: Git-based deploys ensure proper function bundling."
echo "Avoid using 'netlify deploy --prod' directly."
