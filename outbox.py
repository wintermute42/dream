"""A small send queue for every connected device (#187).

Sending to a WebSocket waits while the device's line is full. Dream used to send to its devices one after the other,
so one phone at the edge of the Wi-Fi held up all the others – and, on the way to the output windows, the beamer.
Now nobody waits for a device: `post` and `post_frame` only queue, a task per device sends.

- Messages (text) are never dropped and stay in order. A device whose line has not moved for `STALL` seconds (or that
  is `LIMIT` messages behind) is disconnected instead: its page connects again by itself and gets the whole state
  anew – better than a remote that silently missed a change.
- Pictures (binary) may be dropped: only the latest one waits, a newer picture takes its place in the queue.
"""
import asyncio
import contextlib

STALL = 10.0                  # seconds a message may wait for a device's line before the device is disconnected
LIMIT = 1000                  # messages that may wait for one device at most (its memory stays small)
_boxes: dict = {}             # socket -> Outbox


class Outbox:
    def __init__(self, sock):
        self.sock = sock
        self.loop = asyncio.get_running_loop()
        self.queue: list = []                 # ["text" | "frame", data]; at most one frame
        self.sending = None                   # since when the device has been taking the message on its way
        self.frame = None                     # the waiting frame's entry in the queue
        self.dead = False
        self.dropped = 0                      # pictures replaced by a newer one before they left
        self.wake = asyncio.Event()
        self.idle = asyncio.Event()
        self.idle.set()
        self.task = self.loop.create_task(self._run())

    def put(self, kind: str, data) -> bool:
        """Queues a message; False when the device is gone. Safe from another event loop (the tests have several)."""
        if self.dead or self.loop.is_closed():
            return False
        try:
            here = asyncio.get_running_loop() is self.loop
        except RuntimeError:
            here = False
        if here:
            self._add(kind, data)
        else:
            self.loop.call_soon_threadsafe(self._add, kind, data)
        return not self.dead

    def _add(self, kind: str, data):
        if self.dead:
            return
        stalled = self.loop.time() - self.sending if self.sending is not None else 0.0
        if stalled > STALL or len(self.queue) >= LIMIT:
            print(f"a device did not take its messages for {stalled:.0f} s ({len(self.queue)} waiting): "
                  "disconnected (its page connects again)", flush=True)
            self.close(1013)
            return
        if kind == "frame" and self.frame is not None:
            self.frame[1] = data              # latest wins, at the place in the order the older one had
            self.dropped += 1
            return
        entry = [kind, data]
        if kind == "frame":
            self.frame = entry
        self.queue.append(entry)
        self.idle.clear()
        self.wake.set()

    async def _run(self):
        try:
            while True:
                await self.wake.wait()
                while self.queue:
                    entry = self.queue.pop(0)
                    if entry is self.frame:
                        self.frame = None
                    self.sending = self.loop.time()
                    if entry[0] == "text":
                        await self.sock.send_text(entry[1])
                    else:
                        await self.sock.send_bytes(entry[1])
                    self.sending = None
                self.wake.clear()
                self.idle.set()
        except asyncio.CancelledError:
            raise
        except Exception:                     # the device is gone: its handler notices and tidies up
            self._end()

    def _end(self):
        self.dead = True
        self.queue.clear()
        self.frame = None
        self.idle.set()

    def close(self, code: int | None = None):
        """Stops sending; with a code the socket is closed too (never waiting for a line that does not move)."""
        if self.dead:
            return
        self._end()
        self.task.cancel()
        if code is not None:
            async def bye():
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(self.sock.close(code=code), 5)
            self.loop.create_task(bye())


def box(sock) -> Outbox:
    b = _boxes.get(sock)
    if b is None or (b.loop.is_closed() and not b.dead):
        b = _boxes[sock] = Outbox(sock)
    return b


def post(sock, text: str) -> bool:
    """A message for this device: queued, never waited for. False when the device is gone."""
    return box(sock).put("text", text)


def post_frame(sock, data: bytes) -> bool:
    """A picture for this device: if the one before has not left yet, this one takes its place."""
    return box(sock).put("frame", data)


def drop(sock):
    """The device left: its queue goes."""
    b = _boxes.pop(sock, None)
    if b is not None and not b.loop.is_closed():
        try:
            here = asyncio.get_running_loop() is b.loop
        except RuntimeError:
            here = False
        if here:
            b.close()
        else:
            b.loop.call_soon_threadsafe(b.close)


async def flush():
    """Waits until everything queued in this event loop has left (shutdown, tests)."""
    loop = asyncio.get_running_loop()
    for b in list(_boxes.values()):
        if b.loop is loop and not b.dead:
            await b.idle.wait()
