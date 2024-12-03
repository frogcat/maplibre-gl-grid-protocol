import Pbf from "pbf";
import { writeTile } from "./proto/vector_tile.js";
const { MercatorCoordinate, LngLatBounds } = maplibregl;

function parse(url) {
  const tokens = url.replace(/\.pbf$/, "").split("/");
  const y = parseInt(tokens.pop());
  const x = parseInt(tokens.pop());
  const z = parseInt(tokens.pop());

  const n = Math.pow(2, z);
  const tl = new MercatorCoordinate(x / n, y / n);
  const br = new MercatorCoordinate((x + 1) / n, (y + 1) / n);
  const sw = new MercatorCoordinate(x / n, (y + 1) / n).toLngLat();
  const ne = new MercatorCoordinate((x + 1) / n, y / n).toLngLat();

  return {
    tile: { z: z, x: x, y: y },
    bounds: new LngLatBounds(sw, ne),
    mercator: { ox: tl.x, oy: tl.y, w: br.x - tl.x, h: br.y - tl.y },
  };
}

function sec2dms(sec) {
  const a = Math.abs(sec);
  return { d: Math.floor(a / 3600), m: Math.floor(a / 60) % 60, s: sec % 60 };
}
function lon2id(sec) {
  const { d, m, s } = sec2dms(sec);
  return (sec < 0 ? 10000000 : 20000000) + d * 10000 + m * 100 + s;
}
function lat2id(sec) {
  const { d, m, s } = sec2dms(sec);
  return (sec < 0 ? 30000000 : 40000000) + d * 10000 + m * 100 + s;
}

function encode(lines, extent) {
  const zigzag = (v) => (v << 1) ^ (v >> 31);

  const labels = Array.from(new Set(lines.map((a) => a.label)));

  const obj = {
    layers: [
      {
        version: 2,
        name: "line",
        features: lines.map(({ coords, id, label }) => ({
          id: id,
          tags: [0, labels.indexOf(label)],
          type: 2,
          geometry: [
            9, // [00001-001] command id 1 : moveTo,  command count 1
            zigzag(coords[0]),
            zigzag(coords[1]),
            10, // [00001-010] command id 2 : lineTo, command count 3
            zigzag(coords[2] - coords[0]),
            zigzag(coords[3] - coords[1]),
            15, // [00001-111] command id 7 : closePath
          ],
        })),
        keys: ["label"],
        values: labels.map((label) => ({ string_value: label })),
        extent: extent,
      },
    ],
  };

  const pbf = new Pbf();
  writeTile(obj, pbf);
  return pbf.finish();
}

function createLoadFn(options) {
  const defaultOptions = {
    extent: 4096,
    lon2label: function (sec) {
      const { d, m, s } = sec2dms(sec);
      const ddd = d.toString().padStart(3, 0);
      const mm = m.toString().padStart(2, 0);
      const ss = s.toString().padStart(2, 0);
      return `${sec < 0 ? "w" : "E"} ${ddd} ${mm} ${ss}`;
    },
    lat2label: function (sec) {
      const { d, m, s } = sec2dms(sec);
      const dd = d.toString().padStart(2, 0);
      const mm = m.toString().padStart(2, 0);
      const ss = s.toString().padStart(2, 0);
      return `${sec < 0 ? "S" : "N"} ${dd} ${mm} ${ss}`;
    },
    interval: function (tile) {
      if (tile.z < 5) return 3600;
      if (tile.z < 10) return 60;
      return 1;
    },
  };
  if (options) Object.assign(defaultOptions, options);
  const { extent, lat2label, lon2label, interval } = defaultOptions;

  return function (params, callback) {
    const { tile, bounds, mercator } = parse(params.url);

    const [dx, dy] = (function () {
      const s = interval(tile);
      return Array.isArray(s) ? s : [s, s];
    })();

    const lines = [];

    const x1 = Math.floor((bounds.getWest() * 3600) / dx) * dx;
    const x2 = Math.floor((bounds.getEast() * 3600) / dx) * dx;

    for (let x = x1; x <= x2; x += dx) {
      const mx = MercatorCoordinate.fromLngLat([x / 3600, 0]).x;
      const tx = Math.floor((extent * (mx - mercator.ox)) / mercator.w);
      if (0 <= tx && tx <= extent)
        lines.push({ coords: [tx, 0, tx, extent], id: lon2id(x), label: lon2label(x) });
    }

    const y1 = Math.floor((bounds.getSouth() * 3600) / dy) * dy;
    const y2 = Math.floor((bounds.getNorth() * 3600) / dy) * dy;

    for (let y = y1; y <= y2; y += dy) {
      const my = MercatorCoordinate.fromLngLat([0, y / 3600, 0]).y;
      const ty = Math.floor((extent * (my - mercator.oy)) / mercator.h);
      if (0 <= ty && ty <= extent)
        lines.push({ coords: [0, ty, extent, ty], id: lat2id(y), label: lat2label(y) });
    }

    const bin = encode(lines, extent);
    const version = maplibregl.version || maplibregl.getVersion();
    if (parseInt(version.split(".")[0]) <= 3) callback(null, bin, null, null);
    else return Promise.resolve({ data: bin });
  };
}

export { createLoadFn };
