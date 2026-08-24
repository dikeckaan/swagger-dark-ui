# Vendored third-party assets

Pinned copies of the CDN assets, so the site runs fully offline (air-gapped
Docker included). Each file is byte-identical to the published CDN build —
the SHA-384 hashes below are the same SRI values the site previously pinned
in `index.html`.

| File | Package | Version | License | SRI (sha384) |
| --- | --- | --- | --- | --- |
| `swagger-ui.css`, `swagger-ui-bundle.js` | [swagger-ui-dist](https://www.npmjs.com/package/swagger-ui-dist) | 5.32.8 | Apache-2.0 | `9Q2fpS+xeS4ffJy6CagnwoUl+4ldAYhOs9pgZuEKxypVModhmZFzeMlvVsAjf7uT`, `IKpAWwsTL0pcw7/Amtnt2eXF4P1BK64WNuY2E/RG15SWLUW5HXzFuyqCSAr/DP8C` |
| `codemirror.min.css`, `codemirror.min.js` | [CodeMirror 5](https://codemirror.net/5/) | 5.65.20 | MIT | `zaeBlB/vwYsDRSlFajnDd7OydJ0cWk+c2OWybl3eSUf6hW2EbhlCsQPqKr3gkznT`, `C7K/Pjo6rtJFtYWv792/hBOrCLhjcAa319ZhwjrDE8zCMEWglI7+S1CUEKD+q6uF` |
| `yaml.min.js` | CodeMirror 5 YAML mode | 5.65.20 | MIT | `9q49Jm3hZMwxEMLImsxPxLiaptHpFz1PVa26Dg6SVIO+rj5kx0cgOM2+4ikKJFH9` |
| `show-hint.min.js`, `show-hint.min.css` | CodeMirror 5 show-hint addon | 5.65.20 | MIT | (added with vendoring) |
| `js-yaml.min.js` | [js-yaml](https://www.npmjs.com/package/js-yaml) | 4.1.0 | MIT | `+pxiN6T7yvpryuJmE1gM9PX7yQit15auDb+ZwwvJOd/4be2Cie5/IuVXgQb/S9du` |
| `lz-string.min.js` | [lz-string](https://www.npmjs.com/package/lz-string) | 1.5.0 | MIT | `0d+Gr7vM4Drod8E3hXKgciWJSWbjD/opKLLygI9ktiWbuvlDwQLzU46wJ9s5gsp7` |

To upgrade one, download the new dist file from the package's CDN/npm
release, verify its hash, replace the file here and update this table.
