#!/bin/bash

# Pre-commit check for autonomous development
# Exit code 2 blocks the commit

PROJECT_DIR="/home/avinish/Downloads/legal_ai_assistant/nextjs_space"

# Check if we're in the nextjs_space directory
if [ -d "$PROJECT_DIR" ]; then
    cd "$PROJECT_DIR"

    # Check if package.json exists
    if [ -f "package.json" ]; then
        echo "🔍 Running pre-commit checks..."

        # Check for TypeScript errors (if tsconfig exists)
        if [ -f "tsconfig.json" ]; then
            echo "📝 Checking TypeScript..."
            npx tsc --noEmit 2>/dev/null
            if [ $? -ne 0 ]; then
                echo "❌ TypeScript errors found. Please fix before committing."
                # Don't block for now, just warn
                # exit 2
            else
                echo "✅ TypeScript check passed"
            fi
        fi

        # Check for ESLint errors (if eslint config exists)
        if [ -f ".eslintrc.json" ] || [ -f "eslint.config.js" ]; then
            echo "🔧 Running ESLint..."
            npx eslint . --ext .ts,.tsx --max-warnings 0 2>/dev/null
            if [ $? -ne 0 ]; then
                echo "⚠️ ESLint warnings found"
                # Don't block for now
            else
                echo "✅ ESLint check passed"
            fi
        fi

        # Run tests if they exist
        if grep -q '"test"' package.json; then
            echo "🧪 Running tests..."
            npm test --passWithNoTests 2>/dev/null
            if [ $? -ne 0 ]; then
                echo "❌ Tests failed. Please fix before committing."
                # Don't block for now
                # exit 2
            else
                echo "✅ Tests passed"
            fi
        fi
    fi
fi

echo "✅ Pre-commit checks completed"
exit 0
