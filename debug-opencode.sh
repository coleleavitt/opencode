#!/bin/bash
set -e
BUN=$(which bun)
OC_DIR="/home/cole/WebstormProjects/forks/opencode/packages/opencode"
PRELOAD="$OC_DIR/node_modules/@opentui/solid/scripts/preload.ts"
INDEX="$OC_DIR/src/index.ts"
LOG="/tmp/opencode-gdb-$(date +%Y%m%d-%H%M%S).log"
unset OPENCODE_AUTO_HEAP_SNAPSHOT
echo "GDB log: $LOG"
echo "Snowman55" | sudo -SE gdb -q \
  -ex "set pagination off" \
  -ex "set confirm off" \
  -ex "set logging file $LOG" \
  -ex "set logging overwrite on" \
  -ex "set logging enabled on" \
  -ex "set print thread-events off" \
  -ex "set print inferior-events off" \
  -ex "handle SIGPWR nostop noprint pass" \
  -ex "handle SIGUSR1 nostop noprint pass" \
  -ex "handle SIGUSR2 nostop noprint pass" \
  -ex "handle SIGCHLD nostop noprint pass" \
  -ex "handle SIGWINCH nostop noprint pass" \
  -ex "handle SIGPIPE nostop noprint pass" \
  -ex "handle SIGTRAP stop print" \
  -ex "set follow-fork-mode parent" \
  -ex "set detach-on-fork on" \
  -ex "run --conditions=browser --preload $PRELOAD $INDEX --continue" \
  -ex "echo \n=== CRASH CAUGHT ===\n" \
  -ex "echo \n=== CURRENT THREAD BACKTRACE ===\n" \
  -ex "bt full" \
  -ex "echo \n=== REGISTERS ===\n" \
  -ex "info registers" \
  -ex "echo \n=== ALL THREADS ===\n" \
  -ex "info threads" \
  -ex "echo \n=== ALL THREAD BACKTRACES ===\n" \
  -ex "thread apply all bt full" \
  -ex "echo \n=== MEMORY MAP ===\n" \
  -ex "info proc mappings" \
  -ex "echo \n=== SIGNAL INFO ===\n" \
  -ex "info signals SIGTRAP SIGSEGV SIGABRT" \
  -ex "echo \n=== DISASM AT PC ===\n" \
  -ex "x/20i \$pc-32" \
  -ex "echo \n=== STACK DUMP ===\n" \
  -ex "x/64gx \$sp" \
  -ex "echo \n=== SHARED LIBS ===\n" \
  -ex "info sharedlibrary" \
  -ex "echo \n=== DONE — log at $LOG ===\n" \
  -ex "set logging enabled off" \
  -ex "quit" \
  "$BUN"
