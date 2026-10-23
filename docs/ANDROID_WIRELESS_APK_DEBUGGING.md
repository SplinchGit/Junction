# Secure wireless APK debugging

Junction's `junction-ops` CLI permits wireless ADB only to an **online, known Tailscale peer**. It does not use `adb tcpip 5555`, open a PC firewall port, or connect to a hostel-WiFi address. Android's Wireless debugging still has to expose its pairing and connection ports on an address reachable through Tailscale; this varies by Android version and device. If it does not, use USB or a private, trusted hotspot for a manual Android Studio pairing. Do not mark hostel WiFi as an always-trusted debugging network.

1. Install Tailscale on the phone and sign in to the same tailnet as the PC. In Tailscale on the phone, note its `100.x.y.z` address. The CLI will reject an address that Tailscale on the PC does not currently list as an online peer.
2. On the phone, open **Developer options → Wireless debugging**. Enable it for this session, then choose **Pair device with pairing code**. Android shows a temporary pairing port and six-digit code. Keep the code private.
3. In an interactive PowerShell terminal on the PC, run:

   ```powershell
   cd C:\Users\jf358\Documents\Junction\apps\windows
   node scripts\junction-ops.cjs adb pair 100.x.y.z:PAIR_PORT
   ```

   Enter the code only at ADB's prompt. The CLI intentionally rejects noninteractive pairing; do not put the code on the command line.
4. Return to the main **Wireless debugging** screen. Use its separate **IP address & Port** connection port:

   ```powershell
   node scripts\junction-ops.cjs adb connect 100.x.y.z:DEBUG_PORT
   node scripts\junction-ops.cjs adb devices
   ```

5. The owner must approve the exact APK version and SHA-256 in Junction on the phone before installation. Then run:

   ```powershell
   node scripts\junction-ops.cjs adb install ..\android\build\outputs\apk\debug\app-debug.apk --serial 100.x.y.z:DEBUG_PORT
   ```

The install command also checks the APK metadata and refuses a downgrade. After testing, turn **Wireless debugging** off on the phone and disconnect with `adb disconnect 100.x.y.z:DEBUG_PORT`. Revoke the paired workstation on the phone if this was a one-time session.

If pairing or connection fails, first check that the phone appears as an online peer in Tailscale, then confirm that Android's temporary ports have not changed. Some Android builds bind Wireless debugging only to their WiFi interface, not the Tailscale interface; this CLI will not bypass that limitation by exposing ADB on the hostel network.
