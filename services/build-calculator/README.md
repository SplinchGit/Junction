# Junction build-calculator server

This small Node.js app supplies live component prices to Junction over the local
USB-tether or Wi-Fi-hotspot network. The calculator worksheet itself is built
into the Android app and continues to work when this server is offline.

## Run on Windows

1. Install Node.js 18 or newer.
2. Optionally set `EBAY_APP_ID` and `EBAY_CERT_ID` in the PowerShell window to
   enable live eBay pricing. The worksheet does not need these credentials.
3. Right-click `start.ps1`, choose **Run with PowerShell**, and keep the window open.
4. The script prints one or more URLs such as `http://192.168.137.23:4001`.
5. On the phone, open Junction > Settings > Build Calculator, enter the URL, save,
   then open the **Build** tab and use **Test PC connection**.

The phone can provide the internet connection either way:

- **Wi-Fi hotspot:** connect the PC to the phone's hotspot, then use the PC's
  hotspot-network IPv4 address printed by the script.
- **USB tethering:** enable USB tethering, then use the PC's tether-adapter IPv4
  address printed by the script.

If Windows asks about firewall access, allow Node.js on **Private networks**. Do
not expose port 4001 on a public network or router. The server listens on all PC
interfaces so the phone can reach it; it has no authentication and is intended
only for your private tether/hotspot network.

## Manual start

```powershell
cd services\build-calculator
npm install
npm start
```

`GET /health` verifies connectivity. Live price endpoints return a clear setup
error until the eBay credentials are configured.
