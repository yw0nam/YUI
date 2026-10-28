"""Minimal Factorio RCON client (Source RCON protocol, enough for /coop-rpc round trips)."""

import socket
import struct
import time


class Rcon:
    def __init__(self, host: str, port: int, password: str, timeout: float = 10.0):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self._id = 0
        self._send(3, password)
        pkt_id, _pkt_type, _body = self._recv()
        if pkt_id == -1:
            raise RuntimeError("RCON authentication failed")

    def _send(self, pkt_type: int, body: str) -> None:
        self._id += 1
        payload = struct.pack("<ii", self._id, pkt_type) + body.encode("utf-8") + b"\x00\x00"
        self.sock.sendall(struct.pack("<i", len(payload)) + payload)

    def _recv_exact(self, n: int) -> bytes:
        chunks = []
        while n > 0:
            chunk = self.sock.recv(n)
            if not chunk:
                raise ConnectionError("RCON connection closed")
            chunks.append(chunk)
            n -= len(chunk)
        return b"".join(chunks)

    def _recv(self) -> tuple[int, int, str]:
        (size,) = struct.unpack("<i", self._recv_exact(4))
        pkt_id, pkt_type = struct.unpack("<ii", self._recv_exact(8))
        body = self._recv_exact(size - 8 - 2).decode("utf-8", "replace")
        self._recv_exact(2)  # trailing nulls
        return pkt_id, pkt_type, body

    def command(self, body: str) -> str:
        self._send(2, body)
        pkt_id, _pkt_type, out = self._recv()
        if pkt_id == -1:
            raise RuntimeError("RCON command rejected")
        return out

    def rpc(self, request: dict) -> dict:
        import json

        out = self.command("/coop-rpc " + json.dumps(request))
        return json.loads(out)

    def close(self) -> None:
        self.sock.close()


def wait_for_rcon(host: str, port: int, password: str, deadline_s: float = 60.0) -> Rcon:
    deadline = time.monotonic() + deadline_s
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            return Rcon(host, port, password)
        except OSError as error:  # server not up yet
            last_error = error
            time.sleep(0.25)
    raise RuntimeError(f"RCON did not come up within {deadline_s}s: {last_error}")
