# Third-party notices

This plugin is licensed under GPL-3.0-or-later (see LICENSE). It builds on the
work of the reMarkable open-source community:

## rmscene (MIT)

The `.rm` v6 text codec in `src/rm/codec.ts` is a TypeScript port of the
reading and writing logic of [rmscene](https://github.com/ricklupton/rmscene)
by Rick Lupton and contributors, published under the MIT license:

> Copyright (c) Rick Lupton
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

## reMarkable Sync (GPL-3.0)

The pen rendering calibration in `src/pdf-ink.ts` (per-pen opacity table,
color map, and stroke width factor) follows the values established by
[reMarkable Sync](https://github.com/TimDommett/Remarkable-Sync---Obsidian-Plugin)
by Tim Dommett (KeyStone), published under GPL-3.0. This plugin is licensed
GPL-3.0-or-later, compatible with that origin.

## pdf-lib (MIT)

PDF page manipulation uses [pdf-lib](https://pdf-lib.js.org) by Andrew Dillon
and contributors (MIT), bundled into the release build.

## Not affiliated

reMarkable is a trademark of reMarkable AS. This project is an independent,
unofficial tool and is not affiliated with, endorsed by, or supported by
reMarkable AS or Obsidian.
