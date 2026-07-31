#!/usr/bin/env bash

set -Eeuo pipefail

if [[ -z "${RUNNER_TEMP:-}" ]]; then
  echo "::error::RUNNER_TEMP is required for isolated server process state."
  exit 1
fi

gostone_server_dir="$(mktemp -d "$RUNNER_TEMP/gostone-server.XXXXXX")"
gostone_server_log="$gostone_server_dir/next.log"
gostone_server_pid_file="$gostone_server_dir/session-leader.pid"
gostone_server_start_file="$gostone_server_dir/start"
gostone_server_stop_file="$gostone_server_dir/stop"
gostone_server_pid=""
gostone_server_waiter_pid=""
gostone_server_waiter_start_time=""
gostone_server_owned=0
gostone_server_group_validated=0
gostone_server_start_released=0

gostone_process_start_time() {
  local pid=$1
  local stat_line=""
  local stat_tail=""
  local -a stat_fields=()

  if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]] \
    || [[ ! -r "/proc/$pid/stat" ]] \
    || ! IFS= read -r stat_line <"/proc/$pid/stat"; then
    return 1
  fi
  stat_tail="${stat_line##*) }"
  read -r -a stat_fields <<<"$stat_tail"
  if (( ${#stat_fields[@]} < 20 )) \
    || [[ ! "${stat_fields[19]}" =~ ^[0-9]+$ ]]; then
    return 1
  fi
  printf '%s\n' "${stat_fields[19]}"
}

gostone_waiter_identity_matches() {
  local current_start_time=""

  [[ "$gostone_server_waiter_start_time" =~ ^[0-9]+$ ]] \
    && current_start_time="$(
      gostone_process_start_time "$gostone_server_waiter_pid"
    )" \
    && [[ "$current_start_time" == "$gostone_server_waiter_start_time" ]]
}

gostone_refresh_process_trust() {
  local process_state=""
  local observed_ppid=""
  local observed_pgid=""
  local observed_sid=""

  gostone_server_owned=0
  gostone_server_group_validated=0

  if [[ ! "$gostone_server_pid" =~ ^[1-9][0-9]*$ ]] \
    || [[ ! "$gostone_server_waiter_pid" =~ ^[1-9][0-9]*$ ]] \
    || ! gostone_waiter_identity_matches \
    || ! kill -0 "$gostone_server_pid" 2>/dev/null \
    || ! process_state="$(
      ps -o ppid=,pgid=,sid= -p "$gostone_server_pid" 2>/dev/null
    )"; then
    return 1
  fi

  read -r observed_ppid observed_pgid observed_sid <<<"$process_state"
  if [[ "$observed_ppid" != "$gostone_server_waiter_pid" ]]; then
    return 1
  fi
  gostone_server_owned=1

  if [[ "$observed_pgid" != "$gostone_server_pid" ]] \
    || [[ "$observed_sid" != "$gostone_server_pid" ]]; then
    return 1
  fi
  gostone_server_group_validated=1
}

gostone_cleanup() {
  local exit_status=$?
  local cleanup_failed=0
  local current_group_validated=0
  trap - EXIT INT TERM

  if ! : >"$gostone_server_stop_file"; then
    echo "::error::Could not publish the GoStone server stop gate."
    cleanup_failed=1
  fi

  # A fault may occur after PID publication but before initial validation. Refresh
  # trust here so cleanup can still terminate a proven server process group.
  if gostone_refresh_process_trust; then
    current_group_validated=1
  fi

  if [[ "${GOSTONE_CI_SERVER_FAULT:-}" == "validated-supervisor-loss" ]] \
    && (( current_group_validated != 0 )); then
    echo "::error::Cleanup reused trust after the supervisor relationship was lost."
    cleanup_failed=1
  fi

  if (( gostone_server_start_released == 1 && current_group_validated != 1 )); then
    echo "::error::GoStone server identity could not be revalidated after start."
    cleanup_failed=1
  fi

  if (( current_group_validated == 1 )); then
    if kill -0 -- "-$gostone_server_pid" 2>/dev/null; then
      kill -TERM -- "-$gostone_server_pid" 2>/dev/null || true
      for _ in {1..50}; do
        if ! kill -0 -- "-$gostone_server_pid" 2>/dev/null; then break; fi
        sleep 0.1
      done
    fi

    if kill -0 -- "-$gostone_server_pid" 2>/dev/null; then
      kill -KILL -- "-$gostone_server_pid" 2>/dev/null || true
    fi
  fi

  if [[ "$gostone_server_waiter_pid" =~ ^[1-9][0-9]*$ ]]; then
    for _ in {1..120}; do
      if ! gostone_waiter_identity_matches; then break; fi
      sleep 0.1
    done
    if gostone_waiter_identity_matches; then
      kill -TERM "$gostone_server_waiter_pid" 2>/dev/null || true
      for _ in {1..20}; do
        if ! gostone_waiter_identity_matches; then break; fi
        sleep 0.1
      done
    fi
    if gostone_waiter_identity_matches; then
      kill -KILL "$gostone_server_waiter_pid" 2>/dev/null || true
    fi
    wait "$gostone_server_waiter_pid" 2>/dev/null || true
    if gostone_waiter_identity_matches; then
      echo "::error::GoStone server supervisor survived cleanup."
      cleanup_failed=1
    fi
  fi

  if (( current_group_validated == 1 )); then
    if kill -0 -- "-$gostone_server_pid" 2>/dev/null; then
      echo "::error::GoStone server process group survived cleanup."
      cleanup_failed=1
    else
      echo "Verified GoStone server process group exited."
    fi
  elif [[ "$gostone_server_pid" =~ ^[1-9][0-9]*$ ]]; then
    # Before the start gate, the session leader has no long-lived descendants and
    # exits when the private stop gate appears. This covers supervisor loss without
    # ever signaling an untrusted negative process-group identifier.
    for _ in {1..120}; do
      if ! kill -0 "$gostone_server_pid" 2>/dev/null; then break; fi
      sleep 0.1
    done
    if kill -0 "$gostone_server_pid" 2>/dev/null; then
      echo "::error::Unvalidated GoStone session leader survived cleanup."
      cleanup_failed=1
    else
      echo "Verified unvalidated GoStone session leader exited."
    fi
  fi

  if (( exit_status != 0 || cleanup_failed != 0 )); then
    echo "::group::GoStone server log"
    if [[ -f "$gostone_server_log" ]]; then
      tail -n 500 "$gostone_server_log" || true
    else
      echo "Server log was not created."
    fi
    echo "::endgroup::"
  fi

  if (( cleanup_failed != 0 )); then exit_status=1; fi
  exit "$exit_status"
}
trap gostone_cleanup EXIT
trap 'exit 130' INT TERM

# The inner session leader waits behind a private start gate. Therefore a failure
# before ownership validation cannot launch npm or leave its descendants orphaned.
setsid --fork --wait bash -c '
  pid_file=$1
  pid_tmp=$1.$$
  start_file=$2
  stop_file=$3
  shift 3
  printf "%s\n" "$$" >"$pid_tmp" && mv -f -- "$pid_tmp" "$pid_file" \
    || exit 1
  for _ in {1..200}; do
    if [[ -e "$stop_file" ]]; then exit 0; fi
    if [[ -e "$start_file" ]]; then exec "$@"; fi
    sleep 0.05
  done
  exit 124
' -- "$gostone_server_pid_file" "$gostone_server_start_file" \
  "$gostone_server_stop_file" \
  npm run start -- --hostname 127.0.0.1 --port 3101 \
  >"$gostone_server_log" 2>&1 &
gostone_server_waiter_pid=$!
if ! gostone_server_waiter_start_time="$(
  gostone_process_start_time "$gostone_server_waiter_pid"
)"; then
  echo "::error::Could not bind the GoStone server supervisor identity."
  exit 1
fi

for _ in {1..50}; do
  if [[ -s "$gostone_server_pid_file" ]]; then
    IFS= read -r gostone_server_pid <"$gostone_server_pid_file"
    break
  fi
  if ! kill -0 "$gostone_server_waiter_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ ! "$gostone_server_pid" =~ ^[1-9][0-9]*$ ]] \
  || ! kill -0 "$gostone_server_pid" 2>/dev/null; then
  echo "::error::GoStone server did not publish a live session-leader PID."
  exit 1
fi

case "${GOSTONE_CI_SERVER_FAULT:-}" in
  after-pid-publication)
    exit 97
    ;;
  supervisor-loss)
    if ! gostone_waiter_identity_matches; then
      echo "::error::GoStone server supervisor identity changed before fault injection."
      exit 1
    fi
    kill -TERM "$gostone_server_waiter_pid"
    wait "$gostone_server_waiter_pid" 2>/dev/null || true
    gostone_server_waiter_pid=""
    gostone_server_waiter_start_time=""
    exit 98
    ;;
  "" | validated-supervisor-loss)
    ;;
  *)
    echo "::error::Unknown GoStone CI server fault injection."
    exit 2
    ;;
esac

if ! gostone_refresh_process_trust \
  || (( gostone_server_owned != 1 )) \
  || (( gostone_server_group_validated != 1 )); then
  echo "::error::GoStone server session leader failed ownership validation."
  exit 1
fi

if [[ "${GOSTONE_CI_SERVER_FAULT:-}" == "validated-supervisor-loss" ]]; then
  if ! gostone_waiter_identity_matches; then
    echo "::error::GoStone server supervisor identity changed before fault injection."
    exit 1
  fi
  kill -TERM "$gostone_server_waiter_pid"
  wait "$gostone_server_waiter_pid" 2>/dev/null || true
  gostone_server_waiter_pid=""
  gostone_server_waiter_start_time=""
  exit 99
fi

if ! : >"$gostone_server_start_file"; then
  echo "::error::Could not release the GoStone server start gate."
  exit 1
fi
gostone_server_start_released=1

gostone_ready=0
for _ in {1..60}; do
  if curl --fail --silent --max-time 2 \
    http://127.0.0.1:3101/api/health >/dev/null 2>&1; then
    gostone_ready=1
    break
  fi
  if ! kill -0 "$gostone_server_pid" 2>/dev/null; then break; fi
  sleep 1
done
if (( gostone_ready != 1 )); then
  echo "::error::GoStone did not become ready on the isolated port."
  exit 1
fi

curl --fail --silent --show-error --max-time 10 \
  http://127.0.0.1:3101/api/db-health >/dev/null
npm run test:auth
npm run test:live
npm run test:clock
npm run test:scoring-races
