#!/usr/bin/python3
"""Fetch small Wikipedia text extracts only; no arbitrary URLs or downloads."""
import http.client
import ipaddress
import json
import socket
import ssl
import sys
import urllib.parse

HOST = "en.wikipedia.org"
MAX_RESPONSE = 256 * 1024
MAX_OUTPUT = 8_000

class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, address):
        super().__init__(HOST, timeout=6, context=ssl.create_default_context())
        self.address = address
    def connect(self):
        raw = socket.create_connection((self.address, 443), timeout=6)
        self.sock = self._context.wrap_socket(raw, server_hostname=HOST)

def request(address, path):
    ip = ipaddress.ip_address(address)
    if not ip.is_global: raise ValueError("non-public address")
    connection = PinnedHTTPS(str(ip))
    try:
        connection.request("GET", path, headers={"Host": HOST, "User-Agent": "JunctionWorld/1.0 (public text research)", "Accept": "application/json", "Accept-Encoding": "identity", "Connection": "close"})
        response = connection.getresponse()
        if response.status != 200 or response.getheader("Content-Type", "").split(";")[0].strip().lower() != "application/json": raise ValueError("unexpected public research response")
        data = response.read(MAX_RESPONSE + 1)
        if len(data) > MAX_RESPONSE: raise ValueError("research response too large")
        return json.loads(data.decode("utf-8"))
    finally: connection.close()

def main():
    request_data = json.loads(sys.stdin.readline(4096))
    if not isinstance(request_data, dict) or set(request_data) != {"query", "addresses"}: raise ValueError("invalid request")
    query = request_data["query"]
    addresses = request_data["addresses"]
    if not isinstance(query, str) or not 3 <= len(query) <= 160 or not isinstance(addresses, list) or not 1 <= len(addresses) <= 8: raise ValueError("invalid research request")
    safe_addresses = []
    for value in addresses:
        ip = ipaddress.ip_address(value)
        if ip.version == 4 and ip.is_global: safe_addresses.append(str(ip))
    if not safe_addresses: raise ValueError("no public research address")
    params = urllib.parse.urlencode({"action": "query", "list": "search", "srsearch": query, "format": "json", "srlimit": "3", "utf8": "1"})
    search = request(safe_addresses[0], "/w/api.php?" + params)
    rows = search.get("query", {}).get("search", [])
    pages = []
    for row in rows[:3]:
        page_id = row.get("pageid")
        title = row.get("title")
        if not isinstance(page_id, int) or not isinstance(title, str): continue
        params = urllib.parse.urlencode({"action": "query", "prop": "extracts", "explaintext": "1", "exchars": "2400", "pageids": str(page_id), "format": "json", "utf8": "1"})
        data = request(safe_addresses[0], "/w/api.php?" + params)
        page = data.get("query", {}).get("pages", {}).get(str(page_id), {})
        extract = page.get("extract", "")
        if isinstance(extract, str): pages.append({"title": title[:180], "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"), safe="_()"), "text": extract[:2400]})
    output = json.dumps({"source": "Wikipedia", "results": pages}, ensure_ascii=False, separators=(",", ":"))
    if len(output) > MAX_OUTPUT: raise ValueError("research output too large")
    sys.stdout.write(output)

if __name__ == "__main__":
    try: main()
    except Exception:
        sys.stderr.write("public research fetch failed\n")
        raise SystemExit(1)
