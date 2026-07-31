# Third-party notices

## Ten Thousand Tsumego

The curated Go problem positions in `lib/puzzles/curatedCatalog.ts` are adapted
from [sanderland/tsumego](https://github.com/sanderland/tsumego), pinned to commit
`9d2ca58d3188f42a4bb1248d6c2c1ebbaca56ce4`. They are converted from 19x19 SGF
coordinates into a 13x13 corner crop. KataGo supplies the interactive continuation;
the catalog retains the source-marked candidate points. Some source files mark
these candidates with a warning that automatic detection may be imperfect, so
GoStone does not treat every mark as correct: the pinned KataGo worker selects
and validates the actual first move and creates the interactive continuation.

Copyright (c) 2017 Steve Kieffer and/or other authors of the content in that repository

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
