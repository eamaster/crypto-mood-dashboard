# 🔐 Secrets Setup Guide

This guide explains how to properly configure API keys and secrets for the Crypto Mood Dashboard.

## ⚠️ Important Security Notice

**NEVER commit API keys or secrets to version control!** 

### 🚨 If You've Accidentally Committed a Key

If you've accidentally committed an API key to the repository:

1. **Rotate the key immediately** in the provider's dashboard (delete old key, create new one)
2. **Update the key** in Cloudflare Workers: `wrangler secret put COINCAP_API_KEY`
3. **Remove from git history** if the repository is private (see [SECURITY.md](./SECURITY.md) for instructions)
4. **Monitor usage** for any unauthorized access

**Important**: Even if you delete a file containing a key, it remains in git history and can be accessed by anyone with repository access.

See [SECURITY.md](./SECURITY.md) for detailed security guidelines and key rotation procedures.

## 🔑 Required API Keys

### 1. CoinCap Pro API Key (Required)
- **Purpose**: Fetches cryptocurrency prices and historical data
- **Get it from**: [https://pro.coincap.io/](https://pro.coincap.io/)
- **Environment Variable**: `COINCAP_API_KEY`
- **Rate Limit**: 500 requests/minute with Pro key
- **API Docs**: [https://pro.coincap.io/api-docs/](https://pro.coincap.io/api-docs/)

### 2. Cohere AI API Key (Required)
- **Purpose**: Powers sentiment analysis and market mood classification
- **Get it from**: [https://cohere.ai/](https://cohere.ai/)
- **Environment Variable**: `COHERE_API_KEY`

### 3. NewsAPI.org API Key (Required)
- **Purpose**: Fetches cryptocurrency-related news articles
- **Get it from**: [https://newsapi.org/](https://newsapi.org/)
- **Environment Variable**: `NEWSAPI_KEY`

### 4. Admin Purge Token (Required for Admin Endpoints)
- **Purpose**: Protects admin endpoints like `/admin/purge-legacy-cache`
- **How to create**: Generate a secure random token (e.g., `openssl rand -hex 32`)
- **Environment Variable**: `ADMIN_PURGE_TOKEN`
- **Usage**: Use this token when calling admin endpoints to purge cache

### 5. Blockchair API Key (Optional)
- **Purpose**: Provides blockchain data and OHLC price information
- **Get it from**: [https://blockchair.com/api](https://blockchair.com/api)
- **Environment Variable**: `BLOCKCHAIR_KEY`

### 6. NewsData.io API Key (Optional)
- **Purpose**: Backup news source
- **Get it from**: [https://newsdata.io/](https://newsdata.io/)
- **Environment Variable**: `NEWSDATA_KEY`

## 🚀 Setup Instructions

### For Local Development

1. **Copy the example environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit the `.env` file and add your actual API keys:**
   ```bash
   COINCAP_API_KEY=your_actual_coincap_api_key_here
   COHERE_API_KEY=your_actual_cohere_api_key_here
   NEWSAPI_KEY=your_actual_newsapi_key_here
   BLOCKCHAIR_KEY=your_actual_blockchair_key_here
   NEWSDATA_KEY=your_actual_newsdata_key_here
   ENVIRONMENT=development
   ```

### For Cloudflare Workers Deployment

Use Wrangler's secret management system to securely store your API keys:

```bash
# Set required secrets
wrangler secret put COINCAP_API_KEY
wrangler secret put COHERE_API_KEY
wrangler secret put NEWSAPI_KEY
wrangler secret put ADMIN_PURGE_TOKEN

# Set optional secrets
wrangler secret put BLOCKCHAIR_KEY
wrangler secret put NEWSDATA_KEY
```

When prompted, enter your actual API keys. These will be securely stored and encrypted by Cloudflare.

### Verify Your Setup

After setting up your secrets, you can verify they're working by:

1. **For local development**: Check that your `.env` file exists and contains your keys
2. **For production**: Run `wrangler secret list` to see which secrets are configured

## 🔒 Security Best Practices

1. **Never commit `.env` files** - They're already in `.gitignore`
2. **Use different API keys for development and production** when possible
3. **Regularly rotate your API keys** for security
4. **Monitor your API usage** to detect any unauthorized access
5. **Keep your API keys private** - don't share them in chat, email, or screenshots

## 🆘 Troubleshooting

### Common Issues

- **"API key not configured" errors**: Make sure you've set the required secrets using the methods above
- **Rate limiting**: Some APIs have usage limits - check your API dashboard
- **Invalid API key**: Double-check that you've copied the key correctly

### Getting Help

If you encounter issues:
1. Check the Cloudflare Workers logs: `wrangler tail`
2. Verify your API keys are valid by testing them directly with the provider
3. Ensure you're using the correct environment (dev/production)

## 🛠️ Admin Endpoints

### Purge Cache

The worker includes an admin endpoint to purge cache entries:

```bash
# Generate a secure admin token first (if not done)
# On Windows PowerShell:
$token = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})

# On Linux/Mac:
openssl rand -hex 32

# Set the token as a secret
wrangler secret put ADMIN_PURGE_TOKEN
# (paste the generated token when prompted)

# Use the admin endpoint to purge cache
curl -X POST "https://crypto-mood-dashboard-production.smah0085.workers.dev/admin/purge-legacy-cache" \
  -H "Content-Type: application/json" \
  -d '{"token":"YOUR_ADMIN_TOKEN_HERE"}'
```

**Response Example:**
```json
{
  "status": "completed",
  "deleted": 48,
  "keys": ["price_bitcoin", "price_ethereum", "history_bitcoin_7", ...],
  "timestamp": "2025-11-09T10:30:00.000Z"
}
```

## 📝 Notes

- The application will gracefully degrade if optional API keys are missing
- Required API keys (CoinCap, Cohere, NewsAPI, and ADMIN_PURGE_TOKEN) must be present for full functionality
- All secrets are loaded at runtime and never stored in the codebase
- Cache entries are automatically managed by the worker
