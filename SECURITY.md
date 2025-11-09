# 🔒 Security Guide

## ⚠️ Important Security Notice

**NEVER commit API keys, secrets, or sensitive information to version control!**

## 🚨 If You've Accidentally Committed Secrets

If you've accidentally committed an API key or secret to the repository:

### 1. Rotate the Key Immediately

**For CoinCap API Key:**
1. Go to [https://pro.coincap.io/dashboard](https://pro.coincap.io/dashboard)
2. Navigate to API Keys section
3. Delete the compromised key
4. Create a new API key
5. Update the key in Cloudflare Workers secrets: `wrangler secret put COINCAP_API_KEY`

### 2. Remove from Git History (if needed)

If a secret was committed to git history, you may need to rewrite history:

```bash
# WARNING: This rewrites git history. Only do this if the repo is not shared or coordinate with your team first.

# Use git filter-branch or BFG Repo-Cleaner to remove the secret from history
# Example using git filter-branch:
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch COINCAP_MIGRATION_STATUS.md" \
  --prune-empty --tag-name-filter cat -- --all

# Force push (WARNING: This rewrites remote history)
# git push origin --force --all
```

**Note**: If the repository is public or shared, consider the secret permanently compromised and always rotate it, even if you remove it from history.

### 3. Prevent Future Issues

- ✅ Never commit `.env` files (already in `.gitignore`)
- ✅ Never commit files with API keys
- ✅ Use `wrangler secret put` for Cloudflare Workers secrets
- ✅ Use environment variables for local development
- ✅ Review changes with `git diff` before committing
- ✅ Use `.gitignore` to exclude sensitive files

## 🔐 Best Practices

### API Key Management

1. **Use Secrets Management**
   - Cloudflare Workers: Use `wrangler secret put`
   - Local development: Use `.env` file (not committed)

2. **Rotate Keys Regularly**
   - Rotate API keys every 90 days
   - Rotate immediately if exposed

3. **Monitor Usage**
   - Check API dashboards for unusual activity
   - Set up alerts for high usage
   - Review access logs regularly

4. **Use Different Keys for Environments**
   - Development keys for local development
   - Production keys for production deployment
   - Never share keys between environments

### Code Review

- Always review changes before committing
- Look for hardcoded secrets in code
- Check for API keys in documentation
- Verify `.gitignore` excludes sensitive files

### Documentation

- Never include real API keys in documentation
- Use placeholders like `your_api_key_here`
- Show examples, not actual values
- Include instructions for obtaining keys

## 🔍 Checking for Exposed Secrets

### Check Current Files

```bash
# Search for potential API keys in current files
grep -r "COINCAP_API_KEY" --exclude-dir=node_modules --exclude-dir=.git
grep -r "api.*key" --exclude-dir=node_modules --exclude-dir=.git -i
```

### Check Git History

```bash
# Search git history for a specific key (replace with your key)
git log --all -p -S "YOUR_API_KEY_HERE" --source --all

# Check for files that might contain secrets
git log --all --name-only --pretty=format: | sort -u | grep -E "(secret|key|env|config)"
```

## 📋 Required Actions After Key Exposure

1. ✅ **Rotate the key** in the provider's dashboard
2. ✅ **Update the key** in Cloudflare Workers secrets
3. ✅ **Remove from git history** (if repository is private and not shared)
4. ✅ **Monitor usage** for unauthorized access
5. ✅ **Review access logs** for suspicious activity
6. ✅ **Update documentation** to prevent future exposure

## 🆘 Getting Help

If you suspect a key has been compromised:

1. Rotate the key immediately
2. Check API usage logs for unauthorized access
3. Review git history to see when it was exposed
4. Consider using a secrets scanning tool (e.g., GitGuardian, TruffleHog)
5. Update all systems using the compromised key

---

**Remember**: Prevention is better than cure. Always use proper secrets management and never commit sensitive information to version control.

