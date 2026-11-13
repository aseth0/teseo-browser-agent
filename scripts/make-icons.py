# Generates the extension's PNG icons (an orange rounded square with a white galley, Teseo's ship) with
# no dependencies: shapes drawn on a 128-unit grid, each pixel sampled several times for smooth edges.
#   python3 scripts/make-icons.py public/icon
import os, struct, sys, zlib

ORANGE = (194, 65, 12)
WHITE = (255, 255, 255)

def quad(p0, p1, p2, steps=24):
    """A quadratic curve as points (p0 left out)."""
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (i / steps for i in range(1, steps + 1))]

# The hull: stern, the curved keel to the bow, the bow rising, back along the deck.
HULL = [(18, 74), *quad((18, 74), (26, 86), (40, 88)), (94, 88), *quad((94, 88), (106, 84), (112, 70)), (104, 76)]
SAIL = [(44, 32), (88, 32), (88, 70), (44, 70)]
MAST = [((66, 24), (66, 76), 2.5)]
# The bow's curl, from the deck up (a stroke): left out at 16 px, where it would only blur.
CURL = [(104, 76), *quad((104, 76), (112, 66), (108, 58))]

def inside_polygon(x, y, poly):
    hit = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit

def near_segment(x, y, a, b, r):
    (ax, ay), (bx, by) = a, b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= r * r

def inside_rounded_square(x, y, lo=4, hi=124, r=28):
    cx, cy = min(max(x, lo + r), hi - r), min(max(y, lo + r), hi - r)
    return lo <= x <= hi and lo <= y <= hi and (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def color_at(x, y, size):
    if not inside_rounded_square(x, y):
        return None
    strokes = MAST + ([(a, b, 2.5) for a, b in zip(CURL, CURL[1:])] if size > 16 else [])
    if inside_polygon(x, y, SAIL) or inside_polygon(x, y, HULL) or any(near_segment(x, y, a, b, r) for a, b, r in strokes):
        return WHITE
    return ORANGE

def png(size, samples=6):
    rows = []
    scale = 128 / size
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            r = g = b = a = 0
            for sy in range(samples):
                for sx in range(samples):
                    c = color_at((px + (sx + 0.5) / samples) * scale, (py + (sy + 0.5) / samples) * scale, size)
                    if c:
                        r, g, b, a = r + c[0], g + c[1], b + c[2], a + 1
            n = samples * samples
            row += bytes((r // a, g // a, b // a, round(255 * a / n)) if a else (0, 0, 0, 0))
        rows.append(bytes(row))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))

out = sys.argv[1]
for s in (16, 32, 48, 128):
    with open(os.path.join(out, f'{s}.png'), 'wb') as f:
        f.write(png(s))
