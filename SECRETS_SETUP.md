# 🔐 Secrets Setup Guide

This guide explains how to properly configure API keys and secrets for the Crypto Mood Dashboard.

## ⚠️ Important Security Notice

**NEVER commit API keys or secrets to version control!** This repository is now safe for public use because all secrets have been removed from the codebase.

## 🔑 Required API Keys

### 1. Cohere AI API Key (Required)
- **Purpose**: Powers sentiment analysis and market mood classification
- **Get it from**: [https://cohere.ai/](https://cohere.ai/)
- **Environment Variable**: `COHERE_API_KEY`

### 2. NewsAPI.org API Key (Required)
- **Purpose**: Fetches cryptocurrency-related news articles
- **Get it from**: [https://newsapi.org/](https://newsapi.org/)
- **Environment Variable**: `NEWSAPI_KEY`

### 3. Blockchair API Key (Optional)
- **Purpose**: Provides blockchain data and OHLC price information
- **Get it from**: [https://blockchair.com/api](https://blockchair.com/api)
- **Environment Variable**: `BLOCKCHAIR_KEY`

### 4. NewsData.io API Key (Optional)
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
wrangler secret put COHERE_API_KEY
wrangler secret put NEWSAPI_KEY

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

## 📝 Notes

- The application will gracefully degrade if optional API keys are missing
- Required API keys (Cohere and NewsAPI) must be present for full functionality
- All secrets are loaded at runtime and never stored in the codebase
