"""The flow field between two AI pictures (#205): where the shapes of the picture before have gone in the new one.

The stage and the output windows morph with it: they pull the old picture forward along the field and the new one
back, and blend the two – so what the AI invents between two pictures travels instead of appearing twice. The
renderer estimates the field where the picture is made (on the Mac or on the cloud GPU), beside the next picture's
rendering and in a process of its own: a classic optical flow (Lucas-Kanade, coarse to fine) on a grey picture about 128 pixels wide, a few
milliseconds on one CPU core, numpy only. It travels with the picture as a small grid (48 × 27 vectors for a wide
picture, a signed byte per direction: under 3 kB).

How far the field can be trusted is part of it: a vector counts as much as the old picture, moved along the field,
agrees with the new one around it – where it does not, the vector shrinks to nothing and the stage simply cross-fades
there. A picture that has little to do with the one before (a new seed, a new scene, a drop) gets no field at all.

Vectors are shares of the picture's width and height, from the old picture to the new one: what is at (x, y) in the
old picture is at (x + dx, y + dy) in the new one. Nothing here loads PyTorch."""
import os
import threading
import time

import numpy as np
from PIL import Image

SIDE = 128                    # the longer side of the grey pictures the flow is estimated on
CELLS = 48 * 27               # about how many vectors travel: 48 × 27 for a wide picture, 36 × 36 for a square one
UNIT = 508.0                  # a byte's step: 127 steps are a quarter of the picture
MAGIC = b"DRMF"
LEVELS = 3                    # coarse to fine: a quarter, a half, the full grey picture
# how far the moved old picture may be from the new one – the mean difference of the grey values, measured in the
# pictures' own contrast (two unrelated pictures are about 0.5 to 0.8 apart, two neighbours of a calm dream 0.1):
# up to LOCAL[0] around a place its vector counts fully, from LOCAL[1] on not at all; the same for the whole picture
# with WHOLE – past WHOLE[1] no field is sent
LOCAL = (0.25, 0.6)
WHOLE = (0.2, 0.34)


def gray(img: Image.Image) -> np.ndarray:
    """The picture small and grey (0…1), its sides multiples of four so it can be halved twice."""
    w, h = img.size
    k = SIDE / max(w, h)
    size = (max(8, round(w * k / 4) * 4), max(8, round(h * k / 4) * 4))
    return np.asarray(img.convert("L").resize(size, Image.BOX), dtype=np.float32) / 255.0


def _box(a: np.ndarray, r: int) -> np.ndarray:
    """The mean over a window of 2r+1 around every point (the edge repeats)."""
    n = 2 * r + 1
    p = np.pad(a, r, mode="edge")
    c = np.cumsum(p, axis=0, dtype=np.float32)
    p = np.concatenate((c[n - 1:n], c[n:] - c[:-n]))
    c = np.cumsum(p, axis=1, dtype=np.float32)
    return np.concatenate((c[:, n - 1:n], c[:, n:] - c[:, :-n]), axis=1) / (n * n)


def _half(a: np.ndarray) -> np.ndarray:
    h, w = a.shape
    return a.reshape(h // 2, 2, w // 2, 2).mean(axis=(1, 3))


def _double(a: np.ndarray) -> np.ndarray:
    return _box(np.repeat(np.repeat(a, 2, axis=0), 2, axis=1), 1)


def _sample(a: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """a at the (fractional) places x, y – between its points, the edge repeating."""
    h, w = a.shape
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0 = x.astype(np.intp)
    y0 = y.astype(np.intp)
    fx = x - x0
    fy = y - y0
    i = y0 * w + x0
    f = a.ravel()
    top = f[i] * (1 - fx) + f[i + 1] * fx
    bottom = f[i + w] * (1 - fx) + f[i + w + 1] * fx
    return top * (1 - fy) + bottom * fy


def _grid(h: int, w: int):
    return np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))


def _refine(a, b, u, v, steps: int):
    """Lucas-Kanade on one level: u, v so that a(x, y) is b(x + u, y + v), a few steps from where they are."""
    h, w = a.shape
    X, Y = _grid(h, w)
    gy, gx = np.gradient(a)
    r = 3
    xx = _box(gx * gx, r) + 1e-4                       # the small number keeps flat areas still
    yy = _box(gy * gy, r) + 1e-4
    xy = _box(gx * gy, r)
    det = xx * yy - xy * xy
    for _ in range(steps):
        d = _sample(b, X + u, Y + v) - a
        bx = _box(gx * d, r)
        by = _box(gy * d, r)
        u = u - np.clip((yy * bx - xy * by) / det, -1.5, 1.5)
        v = v - np.clip((xx * by - xy * bx) / det, -1.5, 1.5)
        u = _box(u, 2)                                 # neighbours move alike
        v = _box(v, 2)
    return u, v


def estimate(a: np.ndarray, b: np.ndarray):
    """The field from the grey picture a to b. Returns (grid of vectors as shares of the picture, shape rows × columns
    × 2, already weighted with how far each can be trusted; confidence of the whole field 0…1)."""
    if a.shape != b.shape:
        return None, 0.0
    pa, pb = [a], [b]
    for _ in range(LEVELS - 1):
        pa.append(_half(pa[-1]))
        pb.append(_half(pb[-1]))
    u = np.zeros_like(pa[-1])
    v = np.zeros_like(pa[-1])
    for level in range(LEVELS - 1, -1, -1):
        if u.shape != pa[level].shape:
            u = _double(u) * 2
            v = _double(v) * 2
        u, v = _refine(pa[level], pb[level], u, v, 4 if level else 2)
    h, w = a.shape
    X, Y = _grid(h, w)
    contrast = max(0.04, float(a.std() + b.std()) / 2)
    left = _box(np.abs(_sample(b, X + u, Y + v) - a), 4) / contrast   # what the field does not explain, around every place
    whole = float(left.mean())
    confidence = float(np.clip((WHOLE[1] - whole) / (WHOLE[1] - WHOLE[0]), 0, 1))
    if confidence <= 0:
        return None, 0.0
    trust = np.clip((LOCAL[1] - left) / (LOCAL[1] - LOCAL[0]), 0, 1) * confidence
    cols = max(2, min(96, round((CELLS * w / h) ** 0.5)))
    size = (cols, max(2, round(CELLS / cols)))
    small = lambda f: np.asarray(Image.fromarray(f).resize(size, Image.BOX))
    return np.stack((small(u * trust) / w, small(v * trust) / h), axis=-1), confidence


def pack(field: np.ndarray, confidence: float) -> bytes:
    """The field as it travels: "DRMF", columns, rows, confidence (0…255), a spare byte, then per vector two signed
    bytes (dx, dy) in steps of 1/UNIT of the picture, row by row."""
    rows, cols = field.shape[:2]
    data = np.clip(np.rint(field * UNIT), -127, 127).astype(np.int8)
    return MAGIC + bytes((cols, rows, int(round(max(0.0, min(1.0, confidence)) * 255)), 0)) + data.tobytes()


def unpack(data: bytes):
    """(field as shares of the picture, confidence) from pack()'s bytes; (None, 0.0) for anything else."""
    if len(data) < 8 or data[:4] != MAGIC:
        return None, 0.0
    cols, rows = data[4], data[5]
    if cols < 2 or rows < 2 or len(data) != 8 + cols * rows * 2:
        return None, 0.0
    return np.frombuffer(data, dtype=np.int8, offset=8).reshape(rows, cols, 2).astype(np.float32) / UNIT, data[6] / 255.0


def packed_between(a: bytes, b: bytes, shape: tuple) -> bytes | None:
    """The packed field from the grey picture a to b (their bytes, both of this shape), or None when the two have too
    little in common. With plain bytes in and out it can run in a process of its own (render_api.py): the estimate
    is many small steps, and in the renderer's process each of them would hold up the thread that paints."""
    old = np.frombuffer(a, dtype=np.float32).reshape(shape)
    new = np.frombuffer(b, dtype=np.float32).reshape(shape)
    field, confidence = estimate(old, new)
    return pack(field, confidence) if field is not None else None


def leave_with_parent():
    """Starts with the estimate's process: it ends when the renderer that started it is gone, however that ended."""
    parent = os.getppid()

    def watch():
        while os.getppid() == parent:
            time.sleep(1)
        os._exit(0)
    threading.Thread(target=watch, daemon=True).start()


def ready() -> bool:
    """Asked of the estimate's process ahead of the first field, so it has started by then."""
    return True


class Between:
    """The pictures between two for the Syphon source: prev pulled forward along the field, cur pulled back, the two
    blended – what the stage's shader does, here with the nearest pixel (a few milliseconds per picture on one core,
    enough for 30 a second). prev and cur are rows × columns × 4, 8 bit."""

    def __init__(self, prev: np.ndarray, cur: np.ndarray, field: np.ndarray, amount: float = 1.0):
        h, w = cur.shape[:2]
        big = lambda f, n: np.asarray(Image.fromarray(np.ascontiguousarray(f)).resize((w, h), Image.BILINEAR)) * (n * amount)
        self.fx, self.fy = big(field[..., 0], w), big(field[..., 1], h)
        self.x, self.y = _grid(h, w)
        self.shape = cur.shape
        self.prev = np.ascontiguousarray(prev).view(np.uint32).ravel()     # a pixel as one number: one lookup moves it
        self.cur = np.ascontiguousarray(cur).view(np.uint32).ravel()

    def _pulled(self, pixels: np.ndarray, k: float) -> np.ndarray:
        h, w = self.shape[:2]
        x = np.clip(np.rint(self.x + self.fx * k), 0, w - 1).astype(np.int32)
        y = np.clip(np.rint(self.y + self.fy * k), 0, h - 1).astype(np.int32)
        return pixels[y * w + x].view(np.uint8).reshape(self.shape)

    def at(self, t: float) -> np.ndarray:
        """The picture at t (0 = prev, 1 = cur), 8 bit."""
        k = int(round(max(0.0, min(1.0, t)) * 256))
        old = self._pulled(self.prev, -t).astype(np.uint16)
        new = self._pulled(self.cur, 1 - t).astype(np.uint16)
        return ((old * (256 - k) + new * k) >> 8).astype(np.uint8)
