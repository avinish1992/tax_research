#!/bin/bash

# Post-edit hook for automatic formatting and validation
# Runs after Write/Edit operations

# Read the file path from stdin (if provided)
FILE_PATH=""
if [ -p /dev/stdin ]; then
    INPUT=$(cat)
    FILE_PATH=$(echo "$INPUT" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('tool_input', {}).get('file_path', ''))" 2>/dev/null)
fi

# If no file path, exit silently
if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# Get file extension
EXT="${FILE_PATH##*.}"

PROJECT_DIR="/home/avinish/Downloads/legal_ai_assistant/nextjs_space"

# Format based on file type
case "$EXT" in
    ts|tsx|js|jsx|json)
        # Format with Prettier if available
        if [ -f "$PROJECT_DIR/node_modules/.bin/prettier" ]; then
            echo "💅 Formatting $FILE_PATH with Prettier..."
            cd "$PROJECT_DIR" && npx prettier --write "$FILE_PATH" 2>/dev/null
        fi
        ;;
    py)
        # Format with Black if available
        if command -v black &> /dev/null; then
            echo "🐍 Formatting $FILE_PATH with Black..."
            black "$FILE_PATH" 2>/dev/null
        fi
        ;;
    md)
        # No formatting needed for markdown
        ;;
esac

exit 0
