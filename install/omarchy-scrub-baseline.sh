#!/usr/bin/env bash
# Opt-in after verified recovery and SMART review. Never called by general setup.
# Fixed system binary at run time: no root service points into a user's checkout.
set -euo pipefail
export LC_ALL=C
case ${1:-} in
  --plan) echo 'One read-only Btrfs scrub, tomorrow 02:30 local, capped at 192 MiB/s per device, no repair. No changes.'; exit 0;;
  --schedule) ;;
  *) echo "usage: $0 --plan | --schedule --independent-backup-verified|--accept-same-disk-risk" >&2; exit 2;;
esac
case ${2:-} in --independent-backup-verified|--accept-same-disk-risk) ;; *) echo 'Confirm backup boundary first.' >&2; exit 2;; esac
[[ $(findmnt -n -o SOURCE /) == '/dev/mapper/root[/@]' && $(findmnt -n -o FSTYPE /) == btrfs ]]
dm=$(lsblk -dnro KNAME /dev/mapper/root)
[[ $dm =~ ^dm-[0-9]+$ ]]
slaves=("/sys/class/block/$dm/slaves/"*)
[[ ${#slaves[@]} == 1 && ${slaves[0]##*/} == nvme0n1p2 ]]
# Refuse to schedule on unreadable/failed SMART or new Btrfs device errors.
sudo /usr/bin/smartctl -x -j /dev/nvme0n1 | jq -e '.smart_status.passed == true and .nvme_smart_health_information_log.critical_warning == 0 and .nvme_smart_health_information_log.media_errors == 0' >/dev/null
btrfs device stats / | awk '$1 ~ /corruption_errs$/ {c++; if ($2!=2) bad=1;next} {if (NF!=2 || $2!=0) bad=1} END{exit !(c==1 && NR==5 && !bad)}'
[[ $(lsblk -dno TYPE /dev/nvme0n1) == disk ]]
status=$(btrfs scrub status /)
if grep -Eq 'Status:[[:space:]]+running' <<< "$status"; then echo 'Scrub already running' >&2; exit 1; fi
when="$(date -d tomorrow +%F) 02:30:00"
sudo /usr/bin/systemd-run --unit=quattro-baseline-scrub --on-calendar="$when" --timer-property=AccuracySec=1min --property=Nice=19 --property=IOSchedulingClass=idle --property=KillSignal=SIGINT -- /usr/bin/btrfs scrub start -B -r --limit 192M /
echo 'Transient one-shot, not persistent across host reboots. Cancel BEFORE start with sudo systemctl stop quattro-baseline-scrub.timer. During the scrub use sudo btrfs scrub cancel /. Review btrfs scrub status / and counters afterwards; no automatic follow-up or repair.'
