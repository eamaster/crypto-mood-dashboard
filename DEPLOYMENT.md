# 🚀 Deployment Guide

This guide covers deploying the Crypto Mood Dashboard to production.

## 📋 Prerequisites

- Node.js v18+ installed
- Cloudflare account with Workers enabled
- GitHub account
- API keys configured (see [SECRETS_SETUP.md](./SECRETS_SETUP.md))

## 🏗️ Architecture

- **Frontend**: SvelteKit static site deployed to GitHub Pages
- **Backend**: Cloudflare Worker handling API requests
- **Worker URL**: `https://crypto-mood-dashboard-production.smah0085.workers.dev`

## 🔧 Deployment Steps

### 1. Deploy Cloudflare Worker

```bash
# Navigate to project directory
cd crypto-mood-dashboard

# Deploy worker to Cloudflare
npx wrangler deploy

# Expected output:
# ✅ Published crypto-mood-dashboard-production (X.XX sec)
# https://crypto-mood-dashboard-production.smah0085.workers.dev
```

### 2. Verify Worker Deployment

```bash
# Test worker endpoint
curl "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=bitcoin"

# Should return JSON with Bitcoin price data
```

### 3. Deploy Frontend to GitHub Pages

```bash
# Build the project
npm run build

# Commit and push changes
git add .
git commit -m "Deploy: Update frontend"
git push origin main
```

GitHub Actions will automatically build and deploy the `build/` folder to GitHub Pages.

### 4. Configure GitHub Pages

1. Go to repository **Settings** → **Pages**
2. Set **Source** to **"GitHub Actions"**
3. Ensure workflow has write permissions:
   - **Settings** → **Actions** → **General**
   - **Workflow permissions** → **Read and write permissions**

## 🔍 Verification

### Worker Verification

```bash
# Monitor worker logs
npx wrangler tail

# Test endpoints
curl "https://crypto-mood-dashboard-production.smah0085.workers.dev/price?coin=ethereum"
curl "https://crypto-mood-dashboard-production.smah0085.workers.dev/history?coin=bitcoin&days=7"
```

### Frontend Verification

1. Visit your GitHub Pages URL
2. Open DevTools (F12) → Network tab
3. Verify API requests are working
4. Test coin switching functionality
5. Check for console errors

## 🐛 Troubleshooting

### Worker Not Deploying

```bash
# Check Wrangler configuration
cat wrangler.toml

# Verify secrets are set
npx wrangler secret list

# Force redeploy
npx wrangler deploy --force
```

### Frontend Not Updating

1. Check GitHub Actions status
2. Verify build completed successfully
3. Clear browser cache (Ctrl+Shift+R)
4. Check if `build/` folder exists locally

### CORS Errors

- Verify worker CORS headers are set correctly
- Check worker URL in `src/lib/config.js`
- Ensure worker is deployed and accessible

### API Errors

- Verify API keys are set in Cloudflare secrets
- Check worker logs: `npx wrangler tail`
- Test API endpoints directly

## 📊 Monitoring

### Worker Metrics

Monitor via Cloudflare Dashboard:
- Request count
- Error rate
- Response times
- Rate limit hits

### Frontend Analytics

Consider adding:
- Google Analytics
- Sentry for error tracking
- Performance monitoring

## 🔄 Rollback Procedure

### Rollback Worker

```bash
# View deployment history
npx wrangler deployments list

# Rollback to previous version
npx wrangler rollback --message "Rollback due to issues"
```

### Rollback Frontend

```bash
# Revert last commit
git revert HEAD
git push origin main

# Or revert to specific commit
git revert <commit-hash>
git push origin main
```

## 🎯 Performance Optimization

The dashboard includes several performance optimizations:

- **Parallel API fetching**: Price and history load simultaneously
- **Request timeouts**: Prevents hanging requests (15s for price, 20s for history)
- **Smart caching**: KV storage with POP caching for faster responses
- **Error handling**: Graceful fallbacks on failures
- **Non-blocking operations**: News and sentiment load in background

## 📝 Environment Variables

### Required Secrets (Cloudflare Worker)

```bash
wrangler secret put COINCAP_API_KEY
wrangler secret put COHERE_API_KEY
wrangler secret put NEWSAPI_KEY
wrangler secret put ADMIN_PURGE_TOKEN
```

### Optional Secrets

```bash
wrangler secret put BLOCKCHAIR_KEY
wrangler secret put NEWSDATA_KEY
```

See [SECRETS_SETUP.md](./SECRETS_SETUP.md) for details.

## 🔗 Links

- **Worker Dashboard**: https://dash.cloudflare.com/
- **GitHub Actions**: https://github.com/eamaster/crypto-mood-dashboard/actions
- **Production URL**: https://hesam.me/crypto-mood-dashboard/

## 📅 Maintenance

### Regular Tasks

- Monitor API rate limits
- Check error logs weekly
- Update dependencies monthly
- Review performance metrics

### Update Dependencies

```bash
# Update all dependencies
npm update

# Test locally
npm run dev

# Build and deploy
npm run build
git add . && git commit -m "Update dependencies" && git push
```

---

**Last Updated**: November 2025  
**Status**: ✅ Production Ready

