#!/usr/bin/env python3
"""
Security check for file writes/edits.
Runs before Write/Edit operations to catch security issues.
Exit code 2 blocks the operation.
"""

import sys
import json
import re

# Read tool input from stdin (Claude passes this as JSON)
try:
    input_data = json.load(sys.stdin)
except:
    # If no input or invalid JSON, allow the operation
    sys.exit(0)

file_path = input_data.get('tool_input', {}).get('file_path', '')
content = input_data.get('tool_input', {}).get('content', '')
new_string = input_data.get('tool_input', {}).get('new_string', '')

# Combine content for checking
text_to_check = content or new_string or ''

# Sensitive file patterns - BLOCK these
BLOCKED_PATHS = [
    r'\.env\.production$',
    r'\.env\.local$',
    r'/secrets/',
    r'credentials\.json$',
    r'\.pem$',
    r'\.key$',
    r'id_rsa',
    r'\.aws/credentials',
]

# Sensitive content patterns - WARN about these
SENSITIVE_PATTERNS = [
    (r'["\']?password["\']?\s*[:=]\s*["\'][^"\']+["\']', 'Hardcoded password detected'),
    (r'["\']?api[_-]?key["\']?\s*[:=]\s*["\'][^"\']+["\']', 'Hardcoded API key detected'),
    (r'["\']?secret["\']?\s*[:=]\s*["\'][^"\']+["\']', 'Hardcoded secret detected'),
    (r'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----', 'Private key detected'),
    (r'sk-[a-zA-Z0-9]{20,}', 'OpenAI API key pattern detected'),
    (r'ghp_[a-zA-Z0-9]{36}', 'GitHub token pattern detected'),
    (r'xox[baprs]-[a-zA-Z0-9-]+', 'Slack token pattern detected'),
]

# Check blocked paths
for pattern in BLOCKED_PATHS:
    if re.search(pattern, file_path, re.IGNORECASE):
        print(f"🚫 BLOCKED: Cannot write to sensitive file: {file_path}", file=sys.stderr)
        sys.exit(2)  # Block the operation

# Check for sensitive content (warn but don't block)
warnings = []
for pattern, message in SENSITIVE_PATTERNS:
    if re.search(pattern, text_to_check, re.IGNORECASE):
        warnings.append(message)

if warnings:
    print("⚠️ Security warnings:", file=sys.stderr)
    for warning in warnings:
        print(f"  - {warning}", file=sys.stderr)
    print("Consider using environment variables instead.", file=sys.stderr)
    # Don't block, just warn
    # sys.exit(2)

# Allow the operation
sys.exit(0)
