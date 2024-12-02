# maplibre-gl-grid-protocol

Grid implementation using the addProtocol feature

![maplibre-gl-grid-protocol](https://repository-images.githubusercontent.com/893742629/276ba06d-9cb6-4b54-a519-811d5b5ca6e9)

- Support maplibre-gl-js v1/2/3/4/5
- Based on client side dynamic MVT generation
- The style of latitude and longitude lines can be controlled in the style.json file

## Demo

<https://frogcat.github.io/maplibre-gl-grid-protocol/>

## Usage

1. include JavaScript

```index.html
<script src="https://frogcat.github.io/maplibre-gl-grid-protocol/maplibre-gl-grid-protocol.min.js"></script>
```

2. call addProtocol to register `grid` protocol

```index.html
<script>
  maplibregl.addProtocol("grid", GridProtocol.createLoadFn());

  const map = new maplibregl.Map({
    container: "map",
    center: [140, 40],
    hash: true,
    zoom: 3,
    pitch: 0,
    bearing: 0,
    style: "style.json",
  });
</script>
```

3. add `grid` source

```style.json
{
  "sources": {
    "grid": {
      "type": "vector",
      "tiles": ["grid://{z}/{x}/{y}"],
      "minZoom": 1,
      "maxZoom": 24
    }
  }
}
```

4. write your own layer

```style.json
"layers" : [
   {
      "id": "grid-line",
      "type": "line",
      "source": "grid",
      "source-layer": "line",
      "minzoom": 0,
      "maxzoom": 20,
      "filter": [
        "==",
        [
          "%",
          ["id"],
          [
            "case",
            ["<", ["zoom"], 4],  200000,
            ["<", ["zoom"], 5],  100000,
            ["<", ["zoom"], 6],  50000,
            ["<", ["zoom"], 7],  20000,
            ["<", ["zoom"], 8],  10000,
            ["<", ["zoom"], 9],  3000,
            ["<", ["zoom"], 10], 2000,
            ["<", ["zoom"], 11], 1000,
            ["<", ["zoom"], 12], 500,
            ["<", ["zoom"], 13], 200,
            ["<", ["zoom"], 14], 100,
            ["<", ["zoom"], 15], 30,
            ["<", ["zoom"], 16], 20,
            10
          ]
        ],
        0
      ],
      "paint": {
        "line-color": ["case", ["<", ["id"], 30000000], "#006000", "#600000"],
        "line-width": 20
      }
    },
    {
      "id": "grid-symbol",
      "type": "symbol",
      "source": "grid",
      "source-layer": "line",
      "minzoom": 0,
      "maxzoom": 20,
      "filter": [
        "==",
        [
          "%",
          ["id"],
          [
            "case",
            ["<", ["zoom"],  4], 200000,
            ["<", ["zoom"],  5], 100000,
            ["<", ["zoom"],  6], 50000,
            ["<", ["zoom"],  7], 20000,
            ["<", ["zoom"],  8], 10000,
            ["<", ["zoom"],  9], 3000,
            ["<", ["zoom"], 10], 2000,
            ["<", ["zoom"], 11], 1000,
            ["<", ["zoom"], 12], 500,
            ["<", ["zoom"], 13], 200,
            ["<", ["zoom"], 14], 100,
            ["<", ["zoom"], 15], 30,
            ["<", ["zoom"], 16], 20,
            10
          ]
        ],
        0
      ],
      "layout": {
        "symbol-placement": "line",
        "symbol-spacing": 1,
        "text-field": ["get", "label"],
        "text-size": 18,
        "text-font": ["NotoSansCJKjp-Regular"]
      },
      "paint": {
        "text-color": "#ffffff"
      }
    }
  ]
```

## About source

### layer

Only `line` is included

### id (8-digit fixed-length integer)

`{n}{ddd}{mm}{ss}`

- n : west (1), east (2), south (3), north (4)
- ddd : degree (000 - 180)
- mm : minute (00-59)
- ss : second (00-59)

### property : label (11 character fixed length string)

`[WESN] [0-9]{3} [0-9]{2} [0-9]{2}`

Can be customised through options.

## Options

`GridProtocol.createLoadFn({...})` accept options.

default option is below.

```sample.js
  {
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
      if (tile.z < 8) return 60;
      return 1;
    }
  }
```

### lat2label, lon2label

- It is used when customizing the format of a latitude line label
- You can write a function that takes latitude or longitude as a parameter and returns a string.
- **Important** The latitude or longitude is given as an integer value in seconds

### interval

- It is used to adjust the spacing between latitude and longitude lines
- You can write a function that takes a tile object with x, y, and z parameters and returns the spacing between latitude and longitude lines as an integer value in seconds.
- If you want to change the spacing for both latitude and longitude lines separately, the function will return an array containing two integer values.

### extent

- It is used when changing the extent of the generated MVT
- default=4096

## SeeAlso

### [maplibre-grid](https://github.com/maptiler/maplibre-grid) by [MapTiler](https://github.com/maptiler)

Grid implementation based on Control.
