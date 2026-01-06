# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.7.x   | :white_check_mark: |
| < 0.7   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by emailing **security@lelemon.dev**.

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

**Do not** open a public GitHub issue for security vulnerabilities.

We will acknowledge receipt within 48 hours and provide a detailed response within 7 days, including next steps and timeline for a fix.

## Security Best Practices

When using the SDK:

- Never commit your `LELEMON_API_KEY` to version control
- Use environment variables for API keys
- Rotate API keys if you suspect they've been compromised
- Keep the SDK updated to the latest version
