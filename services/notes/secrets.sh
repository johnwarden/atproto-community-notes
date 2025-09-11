#!/bin/zsh

echo "🔐 Retrieving secrets from Bitwarden..."

# Get item data
ITEM=$(bw get item f567031e-50d4-47ca-b3ae-b354015a046b) || { echo "❌ Failed to get Bitwarden item"; exit 1; }

# Parse key=value pairs from notes
while IFS='=' read -r key value; do
    [[ -n "$key" && ! "$key" =~ ^[[:space:]]*# && -n "$value" ]] && {
        export "$(echo "$key" | xargs)"="$(echo "$value" | xargs)"
        echo "✅ $key exported"
    }
done <<< "$(echo "$ITEM" | jq -r '.notes')"

# Get password from login field
export REPO_PASSWORD=$(echo "$ITEM" | jq -r '.login.password')

# Validate required secrets
[[ -n "$REPO_PASSWORD" ]] && echo "✅ REPO_PASSWORD exported" || { echo "❌ No password"; exit 1; }

