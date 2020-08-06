const test = require('ava');
const cluster = require('../src/cluster')

test('clustering', async t => {
    const objs = [
        { start: 10, end: 15 },
        { start: 16, end: 52 },
        { start: 3, end: 7 }
    ];
    const ranges = cluster(objs);
    t.deepEqual(ranges, [
        { end: 7, objs: [ { end: 7, start: 3, }, ], start: 3 },
        { end: 52, objs: [ { end: 15, start: 10, }, { end: 52, start: 16, }, ], start: 10 }
    ]);
});
