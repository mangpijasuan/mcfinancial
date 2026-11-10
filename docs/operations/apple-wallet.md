# Apple Wallet membership passes

The member dashboard offers a signed Wallet pass to active members when the Apple Wallet IDs are configured. The existing PNG download is separate. The Wallet pass shows the member's name, ID and join year in Apple's generic layout. This initial version has no verification QR or automatic updates to passes already saved on a device.

## Set up the certificate

1. In [Apple Developer](https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates), register a Pass Type ID such as `pass.us.mcfinancial.membership`. Record the Apple Developer Team ID.
2. On a trusted machine, generate a private key and certificate signing request. Keep the key encrypted and record its passphrase securely.

   ```bash
   umask 077
   openssl req -new -newkey rsa:2048 -keyout signer-key.pem -out Wallet.certSigningRequest
   ```

3. Create a Pass Type ID Certificate for that ID, upload the CSR and download the certificate. Download the matching Worldwide Developer Relations intermediate from [Apple PKI](https://www.apple.com/certificateauthority/). Use the issuer of the downloaded signing certificate to select the intermediate. Convert both DER certificates to PEM.

   ```bash
   openssl x509 -inform DER -in pass.cer -out signer-cert.pem
   openssl x509 -inform DER -in wwdr.cer -out wwdr.pem
   ```

## Enable on Hetzner

Place `signer-key.pem`, `signer-cert.pem` and `wwdr.pem` in `club/wallet/` on the server. This directory is mounted read-only into the app and excluded from Git and the build context. Give the application container's user (UID 1001 in the supplied Dockerfile) access. Keep the private key and its passphrase out of Git and chat.

Set these in the existing `.env.production`:

```dotenv
APPLE_WALLET_PASS_TYPE_ID=pass.us.mcfinancial.membership
APPLE_WALLET_TEAM_ID=YOUR_TEAM_ID
APPLE_WALLET_KEY_PASSPHRASE='YOUR_KEY_PASSPHRASE'
```

Rebuild and recreate the app using the [Hetzner deployment runbook](deploy-hetzner-postgres.md). In Safari on an iPhone, sign in as an active member, tap **Add to Apple Wallet**, and confirm that Wallet displays the correct member details. If Wallet rejects the pass, verify the certificate dates, intermediate, Team ID, Pass Type ID and key match. If the portal returns 503, also verify that the app can read the files and decrypt the key.
