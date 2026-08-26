#!/usr/bin/env bash
#
# Print how to reach Podlog after `make up` (#988).
#
# `make up` used to finish silently, so opening Podlog from a phone meant
# knowing to run `hostname -I` -- which on a Docker host also lists the
# bridge addresses (172.17.0.1, 172.18.0.1 here) that are useless for this.
# The default route's source address is the one that actually works.
#
# The LAN line carries a warning because it is the moment someone learns LAN
# access exists, and there is no login: anyone who can open the port can add
# and delete feeds, delete episodes, delete backups and change settings.
set -uo pipefail

PORT=3000

# What the web container is actually bound to. Authoritative, and it respects
# a user who has re-bound it to loopback.
binding=$(docker compose port web "$PORT" 2>/dev/null | tail -1)
host_part=${binding%:*}

lan_ip=""
if [ -z "$binding" ] || [ "$host_part" = "0.0.0.0" ] || [ "$host_part" = "::" ]; then
  case "$(uname -s)" in
    Linux)
      lan_ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || true)
      ;;
    Darwin)
      iface=$(route -n get default 2>/dev/null | awk '/interface: /{print $2}')
      [ -n "$iface" ] && lan_ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
      ;;
  esac
fi

echo
echo "Podlog is running."
echo "  This machine:  http://localhost:${PORT}"

if [ -n "$lan_ip" ]; then
  echo "  Same network:  http://${lan_ip}:${PORT}"
  echo
  echo "  Anyone who can reach that address has full control of Podlog —"
  echo "  there is no login. They can add and delete feeds, delete episodes"
  echo "  and backups, and change settings. Keep it to networks you trust."
  echo "  To turn LAN access off, bind web to 127.0.0.1:${PORT} in"
  echo "  docker-compose.yml. The address is DHCP-assigned and can change on"
  echo "  reboot; reserve it in your router if you want it stable."
else
  echo
  echo "  No LAN address detected — reachable from this machine only."
fi
echo
