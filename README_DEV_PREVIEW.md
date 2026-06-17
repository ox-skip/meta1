# BestCity Market - Dev Preview

## Start Commands

Use the command style for your shell:

- Bash/WSL:
```bash
export NODE_OPTIONS=--max-old-space-size=8192
npx expo start --clear --tunnel
```

- PowerShell:
```powershell
$env:NODE_OPTIONS="--max-old-space-size=8192"
npx expo start --clear --tunnel
```

## Wallet Engine

- `Circle Market Wallet` is the default wallet engine for Arc and supported EVM chains.
- `WalletConnect` and `Base Smart` remain available as fallback engines when Circle is disabled.
- Transactions (checkout, stock create, stock trade, wallet transfers) route through the Market wallet and require the user to approve the Circle challenge.
- Circle user-controlled wallets do not expose a seed phrase. Recovery is handled by Circle PIN/device approval.

Required app env:

```bash
EXPO_PUBLIC_CIRCLE_APP_ID=your_circle_app_id
EXPO_PUBLIC_MARKET_WALLET_PROVIDER=circle
# Optional, defaults to Circle production:
EXPO_PUBLIC_CIRCLE_SDK_ENDPOINT=https://api.circle.com/v1/w3s
```

Required Supabase function secret:

```bash
CIRCLE_API_KEY=your_circle_wallet_api_key
```

Required Android/EAS env for Circle's native SDK package:

```bash
PWSDK_MAVEN_URL=https://maven.pkg.github.com/circlefin/w3s-android-sdk
PWSDK_MAVEN_USERNAME=your_github_username
PWSDK_MAVEN_PASSWORD=your_github_package_token
```
