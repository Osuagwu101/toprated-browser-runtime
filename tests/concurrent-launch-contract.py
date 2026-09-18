#!/usr/bin/env python3
"""Guard the fast, capacity-reserved concurrent launch boundary."""

from pathlib import Path

source = Path("api/app/Services/SessionManager.php").read_text()

reservation_start = source.index("$reserved = $this->withCreationLock")
reservation_complete = source.index("if (! isset($reserved['reservedSession'])", reservation_start)
worker_start = source.index("$this->worker->start(", reservation_complete)

assert worker_start > reservation_complete, "Chromium startup must happen after the global creation lock is released"
assert "return ['reservedSession' => $session];" in source, "capacity must be reserved before launch"
assert "WRITER_SESSION_STARTING" in source, "duplicate clicks must not create competing browser starts"
assert "failReservedSession" in source, "failed parallel starts must release reserved capacity"

print("concurrent_launch_contract=pass")
